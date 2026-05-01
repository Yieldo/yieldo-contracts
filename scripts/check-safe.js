const hre = require("hardhat");
const SAFE = "0x25DDB6a1a32986E097dCEF257d9006d9583d6232";
const ABI = [
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function VERSION() view returns (string)",
  "function nonce() view returns (uint256)",
];
async function main() {
  const c = new hre.ethers.Contract(SAFE, ABI, hre.ethers.provider);
  console.log(`${hre.network.name} Safe ${SAFE}`);
  try {
    console.log("  Version:  ", await c.VERSION());
    console.log("  Threshold:", (await c.getThreshold()).toString());
    console.log("  Nonce:    ", (await c.nonce()).toString());
    const owners = await c.getOwners();
    console.log("  Owners:");
    for (const o of owners) console.log("    -", o);
  } catch (e) { console.log("  ❌ Safe not found / not deployed on this chain:", e.shortMessage || e.message); }
}
main().catch(e => { console.error(e); process.exit(1); });
