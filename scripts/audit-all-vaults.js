const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC = {
  1: "https://ethereum-rpc.publicnode.com",
  8453: "https://mainnet.base.org",
  10: "https://mainnet.optimism.io",
  42161: "https://arb1.arbitrum.io/rpc",
  143: "https://rpc.monad.xyz",
  747474: "https://rpc.katanarpc.com",
  999: "https://rpc.hyperliquid.xyz/evm",
};

const ABI = [
  "function asset() view returns (address)",
  "function name() view returns (string)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function previewDeposit(uint256) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

async function probe(provider, addr) {
  const code = await provider.getCode(addr).catch(() => "0x");
  const size = (code.length - 2) / 2;
  if (size === 0) return { status: "NO_CODE", size };

  const c = new ethers.Contract(addr, ABI, provider);
  const safe = async (fn) => { try { return await fn(); } catch(e){ return null; } };
  const [asset, name, totalAssets, totalSupply, preview] = await Promise.all([
    safe(() => c.asset()),
    safe(() => c.name()),
    safe(() => c.totalAssets()),
    safe(() => c.totalSupply()),
    safe(() => c.previewDeposit(1_000_000)),
  ]);

  const works = [asset, totalAssets, preview].every(x => x !== null);
  return {
    status: works ? "OK" : "BROKEN",
    size,
    name: name || "(no name)",
    asset: asset || "(no asset)",
    totalAssets: totalAssets ? totalAssets.toString() : null,
    preview: preview ? preview.toString() : null,
  };
}

async function main() {
  const vaults = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "yieldo-api-v1", "data", "vaults.json"), "utf8"));
  const active = vaults.filter(v => v.type !== "unsupported");
  console.log(`Auditing ${active.length} active vaults...\n`);

  // Group by chain so we reuse providers
  const byChain = {};
  for (const v of active) {
    byChain[v.chain_id] = byChain[v.chain_id] || [];
    byChain[v.chain_id].push(v);
  }

  const broken = [];
  for (const [chainId, list] of Object.entries(byChain)) {
    const rpc = RPC[chainId];
    if (!rpc) { console.log(`[chain ${chainId}] NO RPC — skipping ${list.length} vaults`); continue; }
    const provider = new ethers.JsonRpcProvider(rpc);
    console.log(`[chain ${chainId}] ${list.length} vaults`);
    for (const v of list) {
      let addr;
      try { addr = ethers.getAddress(v.address.toLowerCase()); }
      catch(e) { console.log(`  [BAD ADDR] ${v.address} -- ${v.name}`); continue; }
      const r = await probe(provider, addr);
      const flag = r.status === "OK" ? "OK " : "!! ";
      console.log(`  ${flag} ${addr} size=${r.size.toString().padStart(5)} "${v.name}" -> onchain="${r.name?.slice(0,40)}"`);
      if (r.status !== "OK") broken.push({ ...v, probe: r });
    }
  }

  console.log(`\n\n=== BROKEN / SUSPICIOUS (${broken.length}) ===`);
  for (const b of broken) {
    console.log(JSON.stringify({ address: b.address, name: b.name, chain: b.chain_id, type: b.type, status: b.probe.status, size: b.probe.size }));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
