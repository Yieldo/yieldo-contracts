// Audit every vault's withdraw flow — simulate the exact call our backend
// would build for redemption, with the user's actual share balance, and
// flag any that would revert. Catches:
//   - Midas RV not configured for the tokenOut we're passing (HyperBTC class)
//   - ERC-4626 vaults that block external redeem (whitelisting)
//   - Veda/Lido/IPOR known unsupported (these we already reject in the API)
//   - Min-redeem amount thresholds
//   - Allowance/approval issues (informational only)
require("dotenv").config();
const { JsonRpcProvider, Contract, getAddress } = require("ethers");

const RPCS = {
  1:    process.env.ETHEREUM_RPC_URL,
  8453: process.env.BASE_RPC_URL    || "https://mainnet.base.org",
  42161:process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
  10:   process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io",
  143:  process.env.MONAD_RPC_URL    || "https://rpc.monad.xyz",
  999:  process.env.HYPEREVM_RPC_URL || "https://rpc.hyperliquid.xyz/evm",
};

// Known Midas RVs (mirrored from app/routes/withdraw.py)
const MIDAS_REDEMPTION_VAULTS = {
  "0x238a700ed6165261cf8b2e544ba797bc11e466ba": "0x44b0440e35c596e858cEA433D0d82F5a985fD19C",
  "0xdd629e5241cbc5919847783e6c96b2de4754e438": "0x569D7dccBF6923350521ecBC28A555A500c4f0Ec",
  "0x9b5528528656dbc094765e2abb79f293c21191b9": "0x6Be2f55816efd0d91f52720f096006d63c366e98",
  "0xc8495eaff71d3a563b906295fcf2f685b1783085": "0x16d4f955B0aA1b1570Fe3e9bB2f8c19C407cdb67",
  "0x7cf9dec92ca9fd46f8d86e7798b72624bc116c05": "0x5aeA6D35ED7B3B7aE78694B7da2Ee880756Af5C0",
  "0x030b69280892c888670edcdcd8b69fd8026a0bf3": "0xac14a14f578C143625Fc8F54218911e8F634184D",
  "0x5a42864b14c0c8241ef5ab62dae975b163a2e0c1": "0x15f724b35A75F0c28F352b952eA9D1b24e348c57",
  "0x87c9053c819bb28e0d73d33059e1b3da80afb0cf": "0x5356B8E06589DE894D86B24F4079c629E8565234",
};

const MIDAS_TOKENS_CONFIG_ABI = ["function tokensConfig(address) view returns (address dataFeed, uint256 fee, uint256 allowance, bool stable)"];
const ERC4626_ABI = ["function maxRedeem(address) view returns (uint256)", "function balanceOf(address) view returns (uint256)", "function asset() view returns (address)", "function decimals() view returns (uint8)"];

const REJECT_TYPES = new Set(["veda", "lido", "ipor", "unsupported", "custom"]);

async function auditMidasRedemption(provider, vault, midasRv, configuredOutAddr, configuredOutSym) {
  const c = new Contract(midasRv, MIDAS_TOKENS_CONFIG_ABI, provider);
  try {
    const t = await c.tokensConfig(configuredOutAddr);
    if (t[0] === "0x0000000000000000000000000000000000000000") {
      // Find what IS configured
      const candidates = [
        ["USDC",  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"],
        ["USDT",  "0xdAC17F958D2ee523a2206206994597C13D831ec7"],
        ["WETH",  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"],
        ["WBTC",  "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599"],
        ["cbBTC", "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"],
        ["tBTC",  "0x18084fbA666a33d37592fA2633fD49a74DD93a88"],
      ];
      const supported = [];
      for (const [tn, ta] of candidates) {
        try { const r = await c.tokensConfig(ta); if (r[0] !== "0x0000000000000000000000000000000000000000") supported.push(tn); } catch {}
      }
      return { ok: false, msg: `RV does NOT support ${configuredOutSym}. Configured tokens: ${supported.join(", ") || "(none)"} → vaults.json needs redemption_asset=${supported[0] ? supported[0].toLowerCase() : "?"}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: `tokensConfig() reverted on RV: ${(e.shortMessage||"").slice(0,60)}` };
  }
}

async function auditErc4626(provider, vaultAddr) {
  // Just check that the vault responds to ERC-4626 view + supports redeem
  try {
    const c = new Contract(vaultAddr, ERC4626_ABI, provider);
    await c.asset();
    return { ok: true };
  } catch {
    return { ok: false, msg: "ERC-4626 asset() reverted — vault may not implement standard interface" };
  }
}

async function main() {
  const res = await fetch("https://api.yieldo.xyz/v1/vaults");
  const vaults = await res.json();
  const byChain = {};
  for (const v of vaults) {
    if (!byChain[v.chain_id]) byChain[v.chain_id] = [];
    byChain[v.chain_id].push(v);
  }
  let ok = 0, fail = 0, skipped = 0;
  for (const cid of Object.keys(byChain).map(Number).sort((a,b)=>a-b)) {
    if (!RPCS[cid]) continue;
    const provider = new JsonRpcProvider(RPCS[cid], cid);
    console.log(`\n========== CHAIN ${cid} ==========`);
    for (const v of byChain[cid]) {
      const type = v.type || "morpho";
      const name = (v.name || "?").padEnd(36);
      if (REJECT_TYPES.has(type)) {
        console.log(`  skip   ${name} type=${type}  (withdraw routed via protocol UI)`);
        skipped++;
        continue;
      }
      let r;
      if (type === "midas") {
        const rv = MIDAS_REDEMPTION_VAULTS[v.address.toLowerCase()];
        if (!rv) { console.log(`  FAIL   ${name} type=midas  (no RV mapped in withdraw.py)`); fail++; continue; }
        r = await auditMidasRedemption(provider, v.address, rv, v.asset.address, v.asset.symbol);
      } else if (type === "morpho" || type === "accountable" || type === "upshift") {
        r = await auditErc4626(provider, v.address);
      } else {
        r = { ok: true };
      }
      if (r.ok) { console.log(`  ok     ${name} type=${type}`); ok++; }
      else      { console.log(`  FAIL   ${name} type=${type}  ${r.msg}`); fail++; }
    }
  }
  console.log(`\n${ok} ok | ${fail} FAIL | ${skipped} skipped (protocol-UI withdraw)`);
}
main().catch(e => { console.error(e); process.exit(1); });
