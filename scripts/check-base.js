const hre = require("hardhat");
async function main() {
  const proxy = "0xF6B7723661d52E8533c77479d3cad534B4D147Aa";
  const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const slot = await hre.ethers.provider.getStorage(proxy, IMPL_SLOT);
  console.log("Impl slot:", slot);
  console.log("Current impl:", "0x" + slot.slice(-40));
  const c = new hre.ethers.Contract(proxy, ["function VERSION() view returns (string)"], hre.ethers.provider);
  console.log("VERSION:", await c.VERSION());
}
main().catch(e => { console.error(e); process.exit(1); });
