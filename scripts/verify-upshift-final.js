// Final verification: for each Upshift vault, confirm on-chain asset() matches
// what our backend reports, AND simulate a deposit through the router.
require("dotenv").config();
const { JsonRpcProvider, Contract } = require("ethers");

const ETH_RPC = process.env.ETHEREUM_RPC_URL;
const ROUTER  = "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d";
const USER    = "0x7E14104e2433fDe49C98008911298F069C9dE41a";

const SYMBOLS = {
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC",
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "WETH",
  "0xa1290d69c65a6fe4df752f95823fae25cb99e5a7": "rsETH",
  "0xe556aba6fe6036275ec1f87eda296be72c811bce": "NUSD",
};

const VAULTS = [
  ["Upshift USDC",            "0x80e1048ede66ec4c364b4f22c8768fc657ff6a42", 1],
  ["Upshift Gamma USDC",      "0x998d7b14c123c1982404562b68eddb057b0477cb", 1],
  ["Upshift Core USDC",       "0xe9b725010a9e419412ed67d0fa5f3a5f40159d32", 1],
  ["Upshift Kelp Gain",       "0xe1b4d34e8754600962cd944b535180bd758e6c2e", 1],
  ["Upshift NUSD",            "0xaeeb2fb279a5aa837367b9d2582f898a63b06ca1", 1],
  ["Upshift High Growth ETH", "0xc824a08db624942c5e5f330d56530cd1598859fd", 1],
];

const PAUSED_SELECTOR = "0xdeeb6943";

async function check(provider, name, vault) {
  const vc = new Contract(vault, [
    "function asset() view returns (address)",
    "function maxDeposit(address) view returns (uint256)",
    "function totalAssets() view returns (uint256)",
  ], provider);
  let asset, maxDep;
  try { asset = await vc.asset(); } catch { console.log(`  ${name}: cannot read asset()`); return; }
  try { maxDep = await vc.maxDeposit(USER); } catch {}
  const sym = SYMBOLS[asset.toLowerCase()] || "unknown";

  // Try a 1-unit deposit simulation from router
  // selector 0x6e553f65 = deposit(uint256,address). Use 1 unit (smallest of any decimals)
  const data = "0x6e553f65" +
    (1n).toString(16).padStart(64, "0") +
    "000000000000000000000000" + USER.slice(2).toLowerCase();
  let depResult = "";
  try {
    await provider.call({ from: ROUTER, to: vault, data });
    depResult = "✓ would succeed";
  } catch (e) {
    const d = e.data || e.info?.error?.data || "";
    if (d.startsWith(PAUSED_SELECTOR)) depResult = "✗ DepositsPaused()";
    else if ((e.shortMessage || "").includes("transfer amount exceeds")) depResult = "✓ would succeed (after approval/balance)";
    else depResult = `? revert ${d.slice(0,10) || "(empty)"}`;
  }

  console.log(`  ${name.padEnd(28)}  asset=${sym.padEnd(6)} (${asset.slice(0,10)}…)  maxDep=${(maxDep||"").toString().slice(0,12)}…  ${depResult}`);
}

async function main() {
  const eth = new JsonRpcProvider(ETH_RPC, 1);
  console.log("=== Mainnet Upshift vaults ===");
  for (const [n, a] of VAULTS) await check(eth, n, a);

  console.log("\n=== Monad Upshift AUSD (chain 143) ===");
  try {
    const monad = new JsonRpcProvider("https://testnet-rpc.monad.xyz", 143);
    await check(monad, "Upshift AUSD (Monad)", "0x36edbf0c834591bfdfcac0ef9605528c75c406aa");
  } catch (e) {
    console.log("  Monad RPC failed:", e.shortMessage || e.message);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
