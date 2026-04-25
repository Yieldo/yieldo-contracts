// Generic cross-chain vault deposit tester from Base ETH.
//
// Mirrors the frontend DepositModal flow end-to-end:
//   - SIWE login
//   - /v1/quote + /v1/quote/build
//   - send source tx + PATCH tx_hash to /v1/deposits/{id}/tx
//   - if two-step: build a child record (parent_tracking_id), send dest tx,
//     PATCH child tx_hash so HistoryPage shows both legs
//
// Usage:
//   node scripts/cross-chain-vault-test.js <VAULT_ID> [ETH_AMOUNT]
//
// Example:
//   node scripts/cross-chain-vault-test.js 1:0xbeef01735c132ada46aa9aa4c54623caa92a64cb 0.0006

require("dotenv").config();
const { Wallet, JsonRpcProvider, Contract, parseEther, formatEther, formatUnits } = require("ethers");

const API = process.env.YIELDO_API || "https://api.yieldo.xyz";
const BASE_RPC = process.env.BASE_RPC_URL;
const FROM_CHAIN = 8453;
const NATIVE_ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

const VAULT_ID = process.argv[2];
const AMOUNT_ETH = process.argv[3] || "0.0006";
const PREFERRED_BRIDGE = process.argv[4] || null;
const SLIPPAGE = 0.03;

if (!VAULT_ID) {
  console.error("Usage: node scripts/cross-chain-vault-test.js <VAULT_ID> [ETH_AMOUNT]");
  process.exit(1);
}

const ERC20_ABI = [
  "function approve(address spender, uint256 amount)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];

const RPCS = {
  1: process.env.ETHEREUM_RPC_URL,
  8453: process.env.BASE_RPC_URL,
  42161: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
  10: process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io",
  43114: process.env.AVALANCHE_RPC_URL || "https://api.avax.network/ext/bc/C/rpc",
};

async function siweLogin(wallet) {
  const nonceRes = await fetch(`${API}/v1/users/nonce`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: wallet.address }),
  });
  if (!nonceRes.ok) throw new Error(`nonce: HTTP ${nonceRes.status}`);
  const { message } = await nonceRes.json();
  const signature = await wallet.signMessage(message);
  const loginRes = await fetch(`${API}/v1/users/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: wallet.address, signature }),
  });
  if (!loginRes.ok) throw new Error(`login: ${(await loginRes.json()).detail || loginRes.status}`);
  const { session_token } = await loginRes.json();
  return session_token;
}

async function patchTxHash(trackingId, txHash) {
  const r = await fetch(`${API}/v1/deposits/${trackingId}/tx`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tx_hash: txHash }),
  });
  if (!r.ok) console.warn(`  ⚠ PATCH /tx failed: HTTP ${r.status}`);
  else console.log(`  ✓ tx_hash reported to backend (tracking ${trackingId})`);
}

async function waitForToken(provider, tokenAddr, owner, expectedAtLeast, timeoutMs = 600_000) {
  const tok = new Contract(tokenAddr, ERC20_ABI, provider);
  const start = Date.now();
  let last = 0n;
  while (Date.now() - start < timeoutMs) {
    const bal = await tok.balanceOf(owner);
    if (bal !== last) {
      console.log(`    dest balance: ${formatUnits(bal, 18)}…`);
      last = bal;
    }
    if (bal >= expectedAtLeast) return bal;
    await new Promise(r => setTimeout(r, 15000));
  }
  throw new Error("Timed out waiting for bridged asset");
}

async function buildStep2Child(token, baseBody, parentTrackingId, freshAmount) {
  const body = {
    ...baseBody,
    from_chain_id: baseBody.to_chain_id,
    from_token: baseBody.dest_token,
    from_amount: freshAmount.toString(),
    parent_tracking_id: parentTrackingId,
  };
  delete body.to_chain_id;
  delete body.dest_token;
  const r = await fetch(`${API}/v1/quote/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`step2 build: ${(await r.json()).detail || r.status}`);
  return await r.json();
}

async function main() {
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY not set");
  if (!BASE_RPC) throw new Error("BASE_RPC_URL not set");

  console.log(`\n========== ${VAULT_ID} (${AMOUNT_ETH} ETH from Base) ==========`);

  const baseProvider = new JsonRpcProvider(BASE_RPC, FROM_CHAIN);
  const baseWallet = new Wallet(process.env.PRIVATE_KEY, baseProvider);
  console.log("wallet:", baseWallet.address);

  const baseEth = await baseProvider.getBalance(baseWallet.address);
  console.log(`  Base ETH: ${formatEther(baseEth)}`);
  const need = parseEther(AMOUNT_ETH);
  if (baseEth < need + parseEther("0.0001")) {
    throw new Error(`Need ${AMOUNT_ETH} + gas, have ${formatEther(baseEth)}`);
  }

  console.log("[1] SIWE login…");
  const token = await siweLogin(baseWallet);

  // Look up vault to know asset / chain
  const vRes = await fetch(`${API}/v1/vaults/${VAULT_ID}`);
  if (!vRes.ok) throw new Error(`vault lookup: HTTP ${vRes.status}`);
  const vault = await vRes.json();
  const toChain = vault.chain_id;
  const destToken = vault.asset.address;
  console.log(`  vault: ${vault.name} on chain ${toChain}, asset=${vault.asset.symbol}, type=${vault.type}`);

  const quoteBody = {
    from_chain_id: FROM_CHAIN, from_token: NATIVE_ETH, from_amount: need.toString(),
    vault_id: VAULT_ID, user_address: baseWallet.address, slippage: SLIPPAGE,
  };

  console.log("[2] /v1/quote…");
  const qRes = await fetch(`${API}/v1/quote`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(quoteBody),
  });
  if (!qRes.ok) throw new Error(`quote: ${(await qRes.json()).detail}`);
  const quote = await qRes.json();
  console.log(`  type: ${quote.quote_type}, to_amount: ${quote.estimate?.to_amount}`);

  // Local fee guard — TEST SCRIPT ONLY. Aborts before signing when bridge+gas
  // costs would dominate the deposit, so we don't burn $5+ to deliver $1.
  // This protection is *intentionally NOT* in the API — production users decide
  // whether the fee is worth it via the UI.
  const fromUsd = parseFloat(quote.estimate?.from_amount_usd || "0");
  const gasUsd  = parseFloat(quote.estimate?.gas_cost_usd || "0");
  // Estimate bridge spread from from/to deltas via from_amount_usd & to_amount in asset terms
  // For a rough check we use gas + price_impact% applied to from_usd
  const impactPct = quote.estimate?.price_impact || 0;
  const feeUsd = gasUsd + (fromUsd * impactPct / 100);
  console.log(`  fees: ~$${feeUsd.toFixed(2)} on $${fromUsd.toFixed(2)} input (${fromUsd > 0 ? (feeUsd / fromUsd * 100).toFixed(0) : '?'}%)`);
  if (fromUsd > 0 && feeUsd >= fromUsd) {
    throw new Error(`Aborting: fees ($${feeUsd.toFixed(2)}) >= deposit ($${fromUsd.toFixed(2)}). Increase amount or change route.`);
  }
  if (fromUsd > 0 && feeUsd / fromUsd > 0.30) {
    throw new Error(`Aborting: fees are ${(feeUsd/fromUsd*100).toFixed(0)}% of deposit. Increase amount to reduce fee ratio.`);
  }

  console.log("[3] /v1/quote/build…");
  const buildBody = { ...quoteBody, partner_id: "", partner_type: 0 };
  if (PREFERRED_BRIDGE) buildBody.preferred_bridge = PREFERRED_BRIDGE;
  const bRes = await fetch(`${API}/v1/quote/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify(buildBody),
  });
  if (!bRes.ok) throw new Error(`build: ${(await bRes.json()).detail}`);
  const build = await bRes.json();
  console.log(`  two_step: ${build.two_step}, bridge: ${build.tracking?.bridge}`);
  console.log(`  parent tracking_id: ${build.tracking_id}`);

  console.log("[4] sending source tx on Base…");
  const tx1 = await baseWallet.sendTransaction({
    to: build.transaction_request.to,
    data: build.transaction_request.data,
    value: BigInt(build.transaction_request.value || "0"),
    gasLimit: build.transaction_request.gas_limit ? BigInt(build.transaction_request.gas_limit) : undefined,
  });
  console.log(`  hash: ${tx1.hash}`);
  console.log(`  basescan: https://basescan.org/tx/${tx1.hash}`);
  const r1 = await tx1.wait();
  console.log(`  ${r1.status === 1 ? "✓" : "✗"} confirmed block ${r1.blockNumber}`);
  if (r1.status !== 1) { console.error("source tx failed"); process.exit(1); }

  await patchTxHash(build.tracking_id, tx1.hash);

  if (!build.two_step) {
    console.log("\n[5] composer flow — done. The composer call on dest does the deposit.");
    console.log(`Watch LiFi: https://explorer.li.fi/tx/${tx1.hash}`);
    return;
  }

  // Two-step: bridge to destToken on toChain, then sign deposit there
  console.log(`\n[5] two-step — waiting for asset on chain ${toChain}…`);
  const destRpc = RPCS[toChain];
  if (!destRpc) throw new Error(`No RPC for chain ${toChain}`);
  const destProvider = new JsonRpcProvider(destRpc, toChain);
  const destWallet = new Wallet(process.env.PRIVATE_KEY, destProvider);
  const expectedDep = BigInt(build.deposit_tx.approval.amount);
  const got = await waitForToken(destProvider, destToken, destWallet.address, expectedDep);
  console.log(`  ✓ got ${formatUnits(got, vault.asset.decimals)} ${vault.asset.symbol}`);

  console.log("[6] building fresh step-2 against actual delivered amount…");
  const child = await buildStep2Child(token, {
    user_address: baseWallet.address,
    vault_id: VAULT_ID,
    slippage: SLIPPAGE,
    to_chain_id: toChain,
    dest_token: destToken,
  }, build.tracking_id, got);
  console.log(`  child tracking_id: ${child.tracking_id}`);

  if (child.approval) {
    const tok = new Contract(destToken, ERC20_ABI, destWallet);
    const cur = await tok.allowance(destWallet.address, child.approval.spender_address);
    if (cur < BigInt(child.approval.amount)) {
      console.log(`  approving ${vault.asset.symbol}…`);
      const at = await tok.approve(child.approval.spender_address, BigInt(child.approval.amount));
      console.log(`  approval hash: ${at.hash}`);
      await at.wait();
    }
  }

  console.log("[7] sending depositFor on dest chain…");
  const tx2 = await destWallet.sendTransaction({
    to: child.transaction_request.to,
    data: child.transaction_request.data,
    value: BigInt(child.transaction_request.value || "0"),
    gasLimit: child.transaction_request.gas_limit ? BigInt(child.transaction_request.gas_limit) : undefined,
  });
  console.log(`  hash: ${tx2.hash}`);
  const r2 = await tx2.wait();
  console.log(`  ${r2.status === 1 ? "✓" : "✗"} deposit confirmed block ${r2.blockNumber}`);
  await patchTxHash(child.tracking_id, tx2.hash);

  console.log(`\nDONE — ${vault.name}: bridge ${tx1.hash}, deposit ${tx2.hash}`);
}

main().catch(e => { console.error("FAILED:", e.message || e); process.exit(1); });
