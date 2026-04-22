const hre = require("hardhat");
async function main() {
  const proxy = process.env.PROXY;
  const slot = "0x" + (BigInt(hre.ethers.keccak256(hre.ethers.toUtf8Bytes("eip1967.proxy.implementation"))) - 1n).toString(16);
  const raw = await hre.ethers.provider.getStorage(proxy, slot);
  const impl = "0x" + raw.slice(-40);
  console.log("proxy impl slot value:", impl);
  const r = await hre.ethers.provider.call({ to: proxy, data: "0xffa1ad74" });
  const v = hre.ethers.AbiCoder.defaultAbiCoder().decode(["string"], r)[0];
  console.log("proxy VERSION:", v);
}
main().catch(console.error);
