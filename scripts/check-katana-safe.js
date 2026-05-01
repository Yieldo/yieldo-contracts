const hre = require("hardhat");
const SAFE = "0x25DDB6a1a32986E097dCEF257d9006d9583d6232";
async function main() {
  const code = await hre.ethers.provider.getCode(SAFE);
  console.log("Safe code length:", (code.length - 2) / 2, "bytes");
  if (code === "0x") { console.log("❌ No Safe deployed at this address on Katana yet"); return; }
  const c = new hre.ethers.Contract(SAFE, ["function getOwners() view returns (address[])","function getThreshold() view returns (uint256)"], hre.ethers.provider);
  console.log("Owners:", await c.getOwners());
  console.log("Threshold:", (await c.getThreshold()).toString());
}
main().catch(e => console.error(e));
