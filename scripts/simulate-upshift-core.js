// Simulate the failing Upshift Core USDC depositFor to see the real revert.
require("dotenv").config();
const { JsonRpcProvider, Contract, getBytes } = require("ethers");

const provider = new JsonRpcProvider(process.env.ETHEREUM_RPC_URL, 1);
const ROUTER = "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d";
const VAULT  = "0xe9b725010a9e419412ed67d0fa5f3a5f40159d32";  // Upshift Core USDC
const USDC   = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const USER   = "0x7E14104e2433fDe49C98008911298F069C9dE41a";
const DATA   = "0x44a312be000000000000000000000000e9b725010a9e419412ed67d0fa5f3a5f40159d32000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4800000000000000000000000000000000000000000000000000000000000f42400000000000000000000000007e14104e2433fde49c98008911298f069c9de41a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001";

async function main() {
  // 1) eth_call against the router with the user's exact data
  console.log("=== eth_call against router ===");
  try {
    const r = await provider.call({ from: USER, to: ROUTER, data: DATA });
    console.log("returned:", r);
  } catch (e) {
    console.log("REVERT:", e.shortMessage || e.message);
    if (e.data) console.log("revert data:", e.data);
    if (e.info?.error?.data) console.log("provider data:", e.info.error.data);
  }

  // 2) Probe the vault directly: maxDeposit + paused-style getters
  console.log("\n=== vault.maxDeposit checks ===");
  const v = new Contract(VAULT, [
    "function maxDeposit(address) view returns (uint256)",
    "function previewDeposit(uint256) view returns (uint256)",
    "function asset() view returns (address)",
    "function totalAssets() view returns (uint256)",
    "function paused() view returns (bool)",
    "function isWhitelisted(address) view returns (bool)",
    "function whitelistEnabled() view returns (bool)",
    "function depositCap() view returns (uint256)",
    "function getDepositCap() view returns (uint256)",
  ], provider);

  for (const fn of ["asset","totalAssets","paused","whitelistEnabled","depositCap","getDepositCap"]) {
    try { console.log(`  ${fn}() =`, await v[fn]()); } catch (e) { /* not present */ }
  }
  for (const who of [["router", ROUTER], ["user", USER]]) {
    try { console.log(`  maxDeposit(${who[0]}) =`, (await v.maxDeposit(who[1])).toString()); } catch {}
    try { console.log(`  isWhitelisted(${who[0]}) =`, await v.isWhitelisted(who[1])); } catch {}
  }
  try { console.log(`  previewDeposit(1 USDC) =`, (await v.previewDeposit(1_000_000n)).toString()); } catch (e) { console.log("  previewDeposit(1 USDC) revert:", e.shortMessage); }

  // 3) Simulate vault.deposit(1 USDC, user) with msg.sender = router (the actual call our router makes)
  console.log("\n=== eth_call vault.deposit(1 USDC, user) from router ===");
  // selector for deposit(uint256,address) = 0x6e553f65
  const depData = "0x6e553f65" +
    "00000000000000000000000000000000000000000000000000000000000f4240" +  // 1 USDC
    "000000000000000000000000" + USER.slice(2).toLowerCase();              // recipient
  try {
    const r = await provider.call({ from: ROUTER, to: VAULT, data: depData });
    console.log("returned:", r);
  } catch (e) {
    console.log("REVERT:", e.shortMessage || e.message);
    if (e.data) console.log("revert data:", e.data);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
