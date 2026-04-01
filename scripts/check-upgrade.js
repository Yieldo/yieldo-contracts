const hre = require("hardhat");
async function main() {
  const network = hre.network.name;
  const proxyAddress = network === "mainnet"
    ? "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d"
    : "0xF6B7723661d52E8533c77479d3cad534B4D147Aa";

  const c = await hre.ethers.getContractAt("DepositRouter", proxyAddress);
  console.log("VERSION:", await c.VERSION());
  console.log("Signer:", await c.getFunction("signer")());
  console.log("Implementation:", await c.getImplementation());
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
