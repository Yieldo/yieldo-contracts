// Read each Upshift vault's contract identity to see which are real
// MetaMorpho ERC-4626 vaults (composer-safe) vs Upshift's own custom
// implementation (composer may revert).
//
// MetaMorpho exposes: MORPHO(), guardian(), curator() — uniquely identifying it.
// Custom Upshift vaults may not expose these.
require("dotenv").config();
const { JsonRpcProvider, Contract } = require("ethers");

const provider = new JsonRpcProvider(process.env.ETHEREUM_RPC_URL, 1);

const VAULTS = [
  ["Upshift USDC",            "0x80e1048ede66ec4c364b4f22c8768fc657ff6a42"],
  ["Upshift Gamma USDC",      "0x998d7b14c123c1982404562b68eddb057b0477cb"],
  ["Upshift Core USDC",       "0xe9b725010a9e419412ed67d0fa5f3a5f40159d32"],
  ["Upshift Kelp Gain",       "0xe1b4d34e8754600962cd944b535180bd758e6c2e"],
  ["Upshift NUSD",            "0xaeeb2fb279a5aa837367b9d2582f898a63b06ca1"],
  ["Upshift High Growth ETH", "0xc824a08db624942c5e5f330d56530cd1598859fd"],
];

const PROBES = [
  ["asset",            "function asset() view returns (address)", []],
  ["totalAssets",      "function totalAssets() view returns (uint256)", []],
  ["maxDeposit",       "function maxDeposit(address) view returns (uint256)", ["0x0000000000000000000000000000000000000001"]],
  // MetaMorpho-specific
  ["MORPHO",           "function MORPHO() view returns (address)", []],
  ["guardian",         "function guardian() view returns (address)", []],
  ["curator",          "function curator() view returns (address)", []],
  // ERC7540 (async)
  ["pendingDeposit",   "function pendingDepositRequest(uint256,address) view returns (uint256)", [0n, "0x0000000000000000000000000000000000000001"]],
  ["claimableDeposit", "function claimableDepositRequest(uint256,address) view returns (uint256)", [0n, "0x0000000000000000000000000000000000000001"]],
];

const TOKEN_NAMES = {
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC",
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "WETH",
  "0xdac17f958d2ee523a2206206994597c13d831ec7": "USDT",
};

async function inspect(name, addr) {
  console.log(`\n=== ${name} (${addr}) ===`);
  const results = {};
  for (const [k, sig, args] of PROBES) {
    try {
      const c = new Contract(addr, [sig], provider);
      const fn = sig.match(/function (\w+)/)[1];
      const v = await c[fn](...args);
      results[k] = v;
    } catch {}
  }
  if (results.asset) {
    const a = results.asset.toLowerCase();
    console.log(`  asset:        ${results.asset} (${TOKEN_NAMES[a] || "unknown"})`);
  }
  if (results.totalAssets) console.log(`  totalAssets:  ${results.totalAssets}`);
  if (results.maxDeposit !== undefined) console.log(`  maxDeposit:   ${results.maxDeposit}`);
  if (results.MORPHO)   console.log(`  MORPHO():     ${results.MORPHO}     ← MetaMorpho ✓`);
  if (results.guardian) console.log(`  guardian():   ${results.guardian}`);
  if (results.curator)  console.log(`  curator():    ${results.curator}`);
  if (results.pendingDeposit !== undefined)   console.log(`  pendingDepositRequest:   ${results.pendingDeposit}     ← ERC-7540 (async!)`);
  if (results.claimableDeposit !== undefined) console.log(`  claimableDepositRequest: ${results.claimableDeposit}`);

  const isMetaMorpho = !!results.MORPHO;
  const isAsync = results.pendingDeposit !== undefined;
  const verdict = isMetaMorpho ? "✓ MetaMorpho — composer-safe"
                : isAsync ? "✗ ERC-7540 ASYNC — composer will revert"
                : "? Unknown — likely custom Upshift vault, composer risky";
  console.log(`  VERDICT: ${verdict}`);
}

async function main() {
  for (const [n, a] of VAULTS) await inspect(n, a);
}
main().catch(e => { console.error(e); process.exit(1); });
