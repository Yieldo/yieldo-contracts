// Withdraw every Yieldo vault position above $0.10, skipping any that would
// cost more than the fee cap in gas.
//
// Usage:
//   node scripts/withdraw-all.js          # dry-run (default), prints plan
//   WET=1 node scripts/withdraw-all.js    # actually send the txs
//
// Caps: $0.20 max gas per withdraw (configurable via FEE_CAP_USD env).
require("dotenv").config();
const { Wallet, JsonRpcProvider, Contract, getAddress, formatUnits, parseUnits } = require("ethers");

const API = process.env.YIELDO_API || "https://api.yieldo.xyz";
const WET = process.env.WET === "1";
const FEE_CAP_USD = parseFloat(process.env.FEE_CAP_USD || "0.20");
const MIN_VALUE_USD = parseFloat(process.env.MIN_VALUE_USD || "0.10");

// Chain RPCs + native asset USD price (live fetched would be better; using
// rough static for the gas estimate sanity check).
const CHAINS = {
  1:    { rpc: process.env.ETHEREUM_RPC_URL,                        native: "ETH",  nativeUsd: 3300, name: "Ethereum",  explorer: "https://etherscan.io" },
  8453: { rpc: process.env.BASE_RPC_URL    || "https://mainnet.base.org",       native: "ETH",  nativeUsd: 3300, name: "Base",       explorer: "https://basescan.org" },
  42161:{ rpc: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",  native: "ETH",  nativeUsd: 3300, name: "Arbitrum",   explorer: "https://arbiscan.io" },
  10:   { rpc: process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io",   native: "ETH",  nativeUsd: 3300, name: "Optimism",   explorer: "https://optimistic.etherscan.io" },
  143:  { rpc: process.env.MONAD_RPC_URL    || "https://rpc.monad.xyz",         native: "MON",  nativeUsd: 1,    name: "Monad",      explorer: "https://monadscan.com" },
  999:  { rpc: process.env.HYPEREVM_RPC_URL || "https://rpc.hyperliquid.xyz/evm", native: "HYPE", nativeUsd: 30, name: "HyperEVM",  explorer: "https://hyperevmscan.io" },
};

const ERC20 = [
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
];

async function siweLogin(wallet) {
  const nonceRes = await fetch(`${API}/v1/users/nonce`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: wallet.address }),
  });
  const { message } = await nonceRes.json();
  const signature = await wallet.signMessage(message);
  const loginRes = await fetch(`${API}/v1/users/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: wallet.address, signature }),
  });
  const { session_token } = await loginRes.json();
  return session_token;
}

async function getPositions(addr) {
  const r = await fetch(`${API}/v1/positions/${addr}`);
  if (!r.ok) throw new Error(`positions: HTTP ${r.status}`);
  const d = await r.json();
  return d.positions || [];
}

async function buildWithdraw(token, p) {
  // Quote first
  const qBody = { vault_id: p.vault_id, shares: p.share_balance, user_address: p.user_address || "", slippage: 0.01 };
  const qRes = await fetch(`${API}/v1/withdraw/quote`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(qBody),
  });
  if (!qRes.ok) {
    const err = await qRes.json().catch(() => ({}));
    return { skip: true, reason: err.detail || `quote HTTP ${qRes.status}` };
  }
  const q = await qRes.json();
  // Build
  const bBody = {
    vault_id: p.vault_id, shares: q.shares, min_amount_out: q.min_amount_out,
    user_address: q.intent.user, nonce: q.intent.nonce, deadline: q.intent.deadline,
    signature: q.signature, mode: q.mode,
  };
  const bRes = await fetch(`${API}/v1/withdraw/build`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(bBody),
  });
  if (!bRes.ok) {
    const err = await bRes.json().catch(() => ({}));
    return { skip: true, reason: err.detail || `build HTTP ${bRes.status}` };
  }
  const b = await bRes.json();
  return { quote: q, build: b };
}

async function estimateGasCostUsd(provider, chain, txReq, fromAddr) {
  try {
    let gasLimit;
    try {
      gasLimit = await provider.estimateGas({ from: fromAddr, to: txReq.to, data: txReq.data, value: BigInt(txReq.value || "0") });
    } catch {
      gasLimit = BigInt(txReq.gas_limit || "200000");
    }
    const fd = await provider.getFeeData();
    const gasPrice = fd.maxFeePerGas || fd.gasPrice || 1n;
    const wei = gasLimit * gasPrice;
    const ethCost = Number(wei) / 1e18;
    return { gasLimit, gasPrice, costUsd: ethCost * chain.nativeUsd };
  } catch (e) {
    return { error: e.shortMessage || e.message };
  }
}

async function main() {
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY not set");
  const baseProvider = new JsonRpcProvider(CHAINS[1].rpc, 1);
  const wallet = new Wallet(process.env.PRIVATE_KEY, baseProvider);
  console.log(`wallet: ${wallet.address}`);
  console.log(`mode:   ${WET ? "WET (will send txs)" : "DRY (preview only)"}`);
  console.log(`caps:   min_value=$${MIN_VALUE_USD}  max_fee=$${FEE_CAP_USD}\n`);

  console.log("[1/3] SIWE login…");
  const token = await siweLogin(wallet);

  console.log("[2/3] fetching positions…");
  const positions = await getPositions(wallet.address);
  positions.forEach(p => p.user_address = wallet.address);
  console.log(`  got ${positions.length} positions`);

  console.log(`\n[3/3] processing each position:\n`);
  const results = [];
  for (const p of positions) {
    const value = p.value_usd || 0;
    const tag = `${p.vault_name?.padEnd(28) || "?"} on ${p.chain_id} (${p.asset_symbol})`;
    if (value < MIN_VALUE_USD) {
      console.log(`  SKIP (dust)        ${tag}  $${value.toFixed(4)}`);
      results.push({ p, action: "skip-dust" });
      continue;
    }
    const chain = CHAINS[p.chain_id];
    if (!chain || !chain.rpc) {
      console.log(`  SKIP (no chain)    ${tag}  $${value.toFixed(2)}`);
      results.push({ p, action: "skip-no-chain" });
      continue;
    }
    try {
      const { skip, reason, quote, build } = await buildWithdraw(token, p);
      if (skip) {
        console.log(`  SKIP (${reason.slice(0, 50)})  ${tag}  $${value.toFixed(2)}`);
        results.push({ p, action: "skip-build", reason });
        continue;
      }
      const provider = new JsonRpcProvider(chain.rpc, p.chain_id);
      const txReq = build.transaction_request;
      const est = await estimateGasCostUsd(provider, chain, txReq, wallet.address);
      if (est.error) {
        console.log(`  SKIP (gas-est failed: ${est.error.slice(0, 40)})  ${tag}`);
        results.push({ p, action: "skip-est-fail" });
        continue;
      }
      const fee = est.costUsd;
      const within = fee <= FEE_CAP_USD;
      const verb = within ? (WET ? "EXEC" : "WOULD-EXEC") : "SKIP (fee)";
      console.log(`  ${verb.padEnd(11)}  ${tag}  $${value.toFixed(2)}  fee≈$${fee.toFixed(3)}  (gas ${est.gasLimit} @ ${formatUnits(est.gasPrice, "gwei")} gwei)`);
      if (!within) { results.push({ p, action: "skip-fee", fee }); continue; }

      if (WET) {
        const chainWallet = new Wallet(process.env.PRIVATE_KEY, provider);
        // Approval if needed (Midas)
        if (build.approval && BigInt(build.approval.amount) > 0n) {
          const tok = new Contract(build.approval.token_address, ERC20, chainWallet);
          const cur = await tok.allowance(wallet.address, build.approval.spender_address);
          if (cur < BigInt(build.approval.amount)) {
            console.log(`        approving ${build.approval.amount} to ${build.approval.spender_address}…`);
            const at = await tok.approve(build.approval.spender_address, BigInt(build.approval.amount));
            await at.wait();
          }
        }
        const sent = await chainWallet.sendTransaction({
          to: txReq.to, data: txReq.data, value: BigInt(txReq.value || "0"),
          gasLimit: est.gasLimit,
        });
        console.log(`        sent: ${chain.explorer}/tx/${sent.hash}`);
        const r = await sent.wait();
        console.log(`        ${r.status === 1 ? "✓ confirmed" : "✗ FAILED"} block ${r.blockNumber}`);
        results.push({ p, action: r.status === 1 ? "exec-ok" : "exec-fail", hash: sent.hash });
      } else {
        results.push({ p, action: "would-exec", fee });
      }
    } catch (e) {
      console.log(`  ERROR  ${tag}: ${(e.shortMessage || e.message || "").slice(0, 80)}`);
      results.push({ p, action: "error", err: e.message });
    }
  }

  console.log(`\nSummary:`);
  const counts = results.reduce((a, r) => { a[r.action] = (a[r.action] || 0) + 1; return a; }, {});
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
}

main().catch(e => { console.error("FAILED:", e); process.exit(1); });
