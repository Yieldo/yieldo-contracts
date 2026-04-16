const { ethers } = require("ethers");

const RPC = {
  1: "https://ethereum-rpc.publicnode.com",
  8453: "https://mainnet.base.org",
  143: "https://rpc.monad.xyz",
  999: "https://rpc.hyperliquid.xyz/evm",
};

// Only probe the non-Veda/Midas/Lido/IPOR suspicious ones
const SUSPICIOUS = [
  { chain: 1,    addr: "0x936FACDf10C8c36294e7B9D28345255539d81bc7", name: "RockSolid rETH Vault", type: "morpho" },
  { chain: 1,    addr: "0xb09f761cb13baca8ec087ac476647361b6314f98", name: "Flagship cbBTC", type: "morpho" },
  { chain: 1,    addr: "0x07ed467acD4ffd13023046968b0859781cb90D9B", name: "9Summits Flagship ETH", type: "custom" },
  { chain: 143,  addr: "0x7Cd231120a60F500887444a9bAF5e1BD753A5e59", name: "Hyperithm Delta Neutral", type: "morpho" },
  { chain: 8453, addr: "0xBEEFE94c8aD530842bfE7d8B397938fFc1cb83b2", name: "Steakhouse Prime USDC", type: "morpho" },
  { chain: 8453, addr: "0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183", name: "Steakhouse USDC", type: "morpho" },
  { chain: 8453, addr: "0x616a4E1db48e22028f6bbf20444Cd3b8e3273738", name: "Seamless USDC Vault", type: "morpho" },
  { chain: 8453, addr: "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca", name: "Moonwell Flagship USDC", type: "morpho" },
  { chain: 8453, addr: "0xa0E430870c4604CcfC7B38Ca7845B1FF653D0ff1", name: "Moonwell Flagship ETH", type: "morpho" },
  { chain: 999,  addr: "0x5e105266db42f78fa814322bce7f388b4c2e61eb", name: "Hyperbeat USDT", type: "custom" },
  { chain: 999,  addr: "0x441794D6a8F9A3739F5D4E98a728937b33489D29", name: "liquidHYPE", type: "custom" },
  { chain: 999,  addr: "0x81e064d0eB539de7c3170EDF38C1A42CBd752A76", name: "Hyperbeat lstHYPE", type: "custom" },
];

const ABI = [
  "function asset() view returns (address)",
  "function name() view returns (string)",
  "function totalAssets() view returns (uint256)",
  "function previewDeposit(uint256) view returns (uint256)",
];

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch(e) { if (i === tries - 1) throw e; await sleep(500 * (i + 1)); }
  }
}

async function main() {
  for (const s of SUSPICIOUS) {
    const provider = new ethers.JsonRpcProvider(RPC[s.chain]);
    const addr = ethers.getAddress(s.addr.toLowerCase());
    console.log(`\n=== [chain ${s.chain}] ${s.name} (${s.type}) ===`);
    console.log(`  addr: ${addr}`);

    const code = await withRetry(() => provider.getCode(addr));
    const size = (code.length - 2) / 2;
    console.log(`  code: ${size} bytes`);

    if (size === 0) { console.log("  !!! NO CODE AT ADDRESS"); continue; }

    // If it looks like a proxy, decode impl
    if (size < 500) {
      const slot = await withRetry(() => provider.getStorage(addr, IMPL_SLOT));
      if (slot !== "0x" + "0".repeat(64)) {
        const impl = ethers.getAddress("0x" + slot.slice(-40));
        const implCode = await withRetry(() => provider.getCode(impl));
        console.log(`  ERC-1967 impl: ${impl} (${(implCode.length - 2) / 2} bytes)`);
      }
    }

    const c = new ethers.Contract(addr, ABI, provider);
    for (const [label, fn] of [
      ["asset", () => c.asset()],
      ["name", () => c.name()],
      ["totalAssets", () => c.totalAssets()],
      ["previewDeposit(1e6)", () => c.previewDeposit(1_000_000)],
    ]) {
      try { const r = await withRetry(fn); console.log(`  ${label}: ${r}`); }
      catch(e) { console.log(`  ${label}: REVERT`); }
      await sleep(100);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
