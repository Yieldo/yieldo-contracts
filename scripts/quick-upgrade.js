const hre = require("hardhat");
async function main() {
  const proxyAddress = "0xF6B7723661d52E8533c77479d3cad534B4D147Aa";
  console.log("Upgrading DepositRouter (price update fix)...");
  const DepositRouter = await hre.ethers.getContractFactory("DepositRouter");
  const upgraded = await hre.upgrades.upgradeProxy(proxyAddress, DepositRouter, {
    unsafeAllow: ["constructor"],
    unsafeSkipStorageCheck: true,
  });
  await upgraded.waitForDeployment();
  const newImpl = await upgraded.getImplementation();
  console.log("Upgraded! New implementation:", newImpl);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
