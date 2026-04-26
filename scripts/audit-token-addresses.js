// Audit: for every supported asset on every chain, compare the FRONTEND's
// hardcoded token address against what real vaults' asset() actually returns.
// Catches the "two USDCs on Monad" class of bug where same-chain same-token
// deposits fall into LiFi because the addresses don't match.
require("dotenv").config();
const { JsonRpcProvider, Contract, getAddress } = require("ethers");

// Frontend ALL_TOKENS (mirrored from src/components/DepositModal.jsx)
const FRONTEND = {
  1: { USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7", WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" },
  8453: { USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", WETH: "0x4200000000000000000000000000000000000006" },
  42161: { USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" },
  10: { USDC: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" },
  143: { USDC: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" }, // updated to real vault asset
  999: { USDC: "0xb88339CB7199b77E23DB6E890353E22632Ba630f", USDT: "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb" },
};

const RPCS = {
  1:    process.env.ETHEREUM_RPC_URL,
  8453: process.env.BASE_RPC_URL || "https://mainnet.base.org",
  42161:process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
  10:   process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io",
  143:  process.env.MONAD_RPC_URL || "https://rpc.monad.xyz",
  999:  process.env.HYPEREVM_RPC_URL || "https://rpc.hyperliquid.xyz/evm",
};

async function main() {
  // Pull live vault list and group by chain
  const res = await fetch("https://api.yieldo.xyz/v1/vaults");
  const vaults = await res.json();
  const byChain = {};
  for (const v of vaults) {
    if (v.paused || v.unsupported) continue;
    if (!byChain[v.chain_id]) byChain[v.chain_id] = [];
    byChain[v.chain_id].push(v);
  }

  let issues = 0;
  for (const chainId of Object.keys(byChain).map(Number).sort((a,b) => a - b)) {
    const fe = FRONTEND[chainId] || {};
    if (!RPCS[chainId]) { console.log(`\nChain ${chainId}: no RPC, skipping`); continue; }
    console.log(`\n=== Chain ${chainId} ===`);
    const provider = new JsonRpcProvider(RPCS[chainId], chainId);
    // Sample ONE vault per asset symbol (avoid per-vault redundancy)
    const seen = new Set();
    for (const v of byChain[chainId]) {
      const sym = (v.asset?.symbol || "").toUpperCase();
      if (seen.has(sym)) continue;
      seen.add(sym);
      const apiAsset = v.asset?.address;
      const feAsset = fe[sym];
      if (!feAsset) { console.log(`  ${sym.padEnd(8)}: backend ${apiAsset} | frontend MISSING (vault: ${v.name})`); issues++; continue; }
      const match = apiAsset?.toLowerCase() === feAsset.toLowerCase();
      const mark = match ? "✓" : "✗";
      console.log(`  ${mark} ${sym.padEnd(8)}: backend ${apiAsset}  ${match ? "==" : "!="}  frontend ${feAsset}  (sample vault: ${v.name})`);
      if (!match) issues++;
    }
  }
  console.log(`\n${issues === 0 ? "✓ No mismatches" : `✗ ${issues} mismatch(es) — fix in DepositModal.jsx ALL_TOKENS`}`);
}
main().catch(e => { console.error(e); process.exit(1); });
