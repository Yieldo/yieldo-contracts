const hre = require("hardhat");
async function main() {
  const [s] = await hre.ethers.getSigners();
  const proxy = "0xF6B7723661d52E8533c77479d3cad534B4D147Aa";
  const impl = "0xf55889e8b93F380Ba2915461516ca446EAb13D7A";
  const abi = ["function upgradeToAndCall(address,bytes) payable"];
  const c = new hre.ethers.Contract(proxy, abi, s);
  const tx = await c.upgradeToAndCall(impl, "0x");
  console.log("tx:", tx.hash);
  const rcpt = await tx.wait();
  console.log("status:", rcpt.status);
  const res = await hre.ethers.provider.call({ to: proxy, data: "0xffa1ad74" });
  const v = hre.ethers.AbiCoder.defaultAbiCoder().decode(["string"], res)[0];
  console.log("VERSION:", v);
}
main().catch(e => { console.error(e.shortMessage || e.message); process.exit(1); });
