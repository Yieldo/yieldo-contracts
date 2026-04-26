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

// Known share-token -> Lido share-token wiring per chain, plus the candidate
// tokens we'll probe.
const TOKEN_CANDIDATES = {
  1: { // Mainnet
    USDC:  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    USDT:  "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    DAI:   "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    USDe:  "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3",
    PYUSD: "0x6c3ea9036406852006290770BEdFcAbA0e23A0e8",
    USDtb: "0xC139190F447e929f090Edeb554D95AbB8b18aC1C",
    USDS:  "0xdC035D45d973E3EC169d2276DDab16f1e407384F",
    WETH:  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    stETH: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
    wstETH:"0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
    weETH: "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
    rsETH: "0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7",
    WBTC:  "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    cbBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    LBTC:  "0x8236a87084f8B84306f72007F36F2618A5634494",
  },
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
