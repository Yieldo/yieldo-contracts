// For every Lido / Midas / Veda / Upshift vault, find which tokens it accepts
// for direct deposit (router/contract config). Flags any vault that accepts
// MORE than one token but our backend only treats the primary as direct —
// users currently get a wasteful LiFi swap on those.
require("dotenv").config();
const { JsonRpcProvider, Contract, getAddress } = require("ethers");

const ROUTERS = {
  1:    "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d",
  8453: "0xF6B7723661d52E8533c77479d3cad534B4D147Aa",
  42161:"0xC5700f4D8054BA982C39838D7C33442f54688bd2",
  10:   "0x7554937Aa95195D744A6c45E0fd7D4F95A2F8F72",
  143:  "0xCD8dfD627A3712C9a2B079398e0d524970D5E73F",
};

const RPCS = {
  1:    process.env.ETHEREUM_RPC_URL,
  8453: process.env.BASE_RPC_URL    || "https://mainnet.base.org",
  42161:process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
  10:   process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io",
  143:  process.env.MONAD_RPC_URL    || "https://rpc.monad.xyz",
  999:  process.env.HYPEREVM_RPC_URL || "https://rpc.hyperliquid.xyz/evm",
};

// Per-chain candidate tokens to probe against vault router/teller config.
const TOKEN_CANDIDATES = {
  1: {
    USDC:"0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", USDT:"0xdAC17F958D2ee523a2206206994597C13D831ec7",
    DAI:"0x6B175474E89094C44Da98b954EedeAC495271d0F", USDe:"0x4c9EDD5852cd905f086C759E8383e09bff1E68B3",
    PYUSD:"0x6c3ea9036406852006290770BEdFcAbA0e23A0e8", USDtb:"0xC139190F447e929f090Edeb554D95AbB8b18aC1C",
    USDS:"0xdC035D45d973E3EC169d2276DDab16f1e407384F", WETH:"0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    stETH:"0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84", wstETH:"0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
    weETH:"0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee", rsETH:"0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7",
    WBTC:"0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", cbBTC:"0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    LBTC:"0x8236a87084f8B84306f72007F36F2618A5634494", reth:"0xae78736Cd615f374D3085123A210448E74Fc6393",
  },
  8453: {
    USDC:"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", WETH:"0x4200000000000000000000000000000000000006",
    cbBTC:"0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", USDbC:"0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
    EURC:"0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42", AERO:"0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    cbETH:"0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", wstETH:"0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452",
  },
  42161:{
    USDC:"0xaf88d065e77c8cC2239327C5EDb3A432268e5831", USDT:"0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    WETH:"0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", WBTC:"0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
    DAI:"0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
  },
  10:   { USDC:"0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", USDT:"0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", WETH:"0x4200000000000000000000000000000000000006" },
  143:  { USDC:"0x754704Bc059F8C67012fEd69BC8A327a5aafb603", AUSD:"0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a", WETH:"0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242" },
  999:  { USDC:"0xb88339CB7199b77E23DB6E890353E22632Ba630f", USDT:"0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb", WHYPE:"0x5555555555555555555555555555555555555555", UBTC:"0x9FDBdA0A5e284c32744D2f17Ee5c74B284993463" },
};

const ROUTER_ABI = [
  "function lidoDepositQueues(address,address) view returns (address)",
  "function midasVaults(address) view returns (address)",
  "function vedaTellers(address) view returns (address)",
];

const MIDAS_DV_ABI = [
  "function tokensConfig(address) view returns (address dataFeed, uint256 fee, uint256 allowance, bool stable)",
];

const VEDA_TELLER_ABI = [
  "function assetData(address) view returns (bool allowDeposits, bool allowWithdraws, uint16 sharePremium)",
  "function isSupported(address) view returns (bool)",
];

const ZERO = "0x0000000000000000000000000000000000000000";

async function checkLido(provider, router, shareToken, candidates) {
  const c = new Contract(router, ROUTER_ABI, provider);
  const found = [];
  for (const [name, addr] of Object.entries(candidates)) {
    try {
      const q = await c.lidoDepositQueues(shareToken, addr);
      if (q && q !== ZERO) found.push(name);
    } catch {}
  }
  return found;
}

async function checkMidas(provider, router, shareToken, candidates) {
  const r = new Contract(router, ROUTER_ABI, provider);
  let iv = ZERO;
  try { iv = await r.midasVaults(shareToken); } catch {}
  if (iv === ZERO) return { iv: null, found: [] };
  const c = new Contract(iv, MIDAS_DV_ABI, provider);
  const found = [];
  for (const [name, addr] of Object.entries(candidates)) {
    try {
      const t = await c.tokensConfig(addr);
      if (t[0] && t[0] !== ZERO) found.push(name);
    } catch {}
  }
  return { iv, found };
}

async function checkVeda(provider, router, vault, candidates) {
  const r = new Contract(router, ROUTER_ABI, provider);
  let teller = ZERO;
  try { teller = await r.vedaTellers(vault); } catch {}
  if (teller === ZERO) return { teller: null, found: [] };
  const t = new Contract(teller, VEDA_TELLER_ABI, provider);
  const found = [];
  for (const [name, addr] of Object.entries(candidates)) {
    try {
      const d = await t.assetData(addr);
      if (d && d[0]) found.push(name); // allowDeposits
    } catch {
      try { if (await t.isSupported(addr)) found.push(name); } catch {}
    }
  }
  return { teller, found };
}

async function main() {
  const res = await fetch("https://api.yieldo.xyz/v1/vaults");
  const vaults = await res.json();
  for (const cid of Object.keys(ROUTERS).map(Number).sort((a,b)=>a-b)) {
    if (!RPCS[cid] || !TOKEN_CANDIDATES[cid]) continue;
    const provider = new JsonRpcProvider(RPCS[cid], cid);
    const router = ROUTERS[cid];
    const cands = TOKEN_CANDIDATES[cid];
    const chainVaults = vaults.filter(v => v.chain_id === cid);
    console.log(`\n========== CHAIN ${cid} ==========`);

    for (const v of chainVaults) {
      if (v.unsupported) continue;
      const t = v.type || "morpho";
      if (!["lido", "midas", "veda"].includes(t)) continue;
      const shareTok = v.share_token || v.address; // for adapter-keyed (lido)
      let found = [];
      if (t === "lido") {
        // Lido share token is what's keyed on router. Our public API doesn't
        // expose share_token, so use vault.address as a fallback proxy here.
        // Since it returns same result for non-multi-contract vaults, ok.
        const probeShare = v.share_token || v.address;
        found = await checkLido(provider, router, probeShare, cands);
      } else if (t === "midas") {
        const r = await checkMidas(provider, router, v.address, cands);
        found = r.found;
      } else if (t === "veda") {
        const r = await checkVeda(provider, router, v.address, cands);
        found = r.found;
      }
      const primary = (v.asset?.symbol || "").toUpperCase();
      const multi = found.filter(s => s.toUpperCase() !== primary);
      if (multi.length > 0) {
        console.log(`  MULTI  ${v.name.padEnd(34)} type=${t.padEnd(6)} primary=${primary}  also accepts: ${multi.join(", ")}`);
      } else if (found.length === 0) {
        console.log(`  ?      ${v.name.padEnd(34)} type=${t.padEnd(6)} no router wiring found`);
      } else {
        // Only primary accepted — no action needed
      }
    }
  }
  console.log("\nMULTI rows above are candidates for accepted_assets list in vaults.json.");
  console.log("? rows mean the router has no wiring — vault not yet supported via our deposit flow.");
}
main().catch(e => { console.error(e); process.exit(1); });
