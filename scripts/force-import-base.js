const hre = require("hardhat");

async function main() {
  const proxyAddress = "0xF6B7723661d52E8533c77479d3cad534B4D147Aa";
  console.log("Force-importing proxy at", proxyAddress, "on Base...");
  const DepositRouter = await hre.ethers.getContractFactory("DepositRouter");
  await hre.upgrades.forceImport(proxyAddress, DepositRouter, { kind: "uups" });
  console.log("Proxy registered!");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
