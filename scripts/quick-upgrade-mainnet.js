const hre = require("hardhat");
async function main() {
  const proxyAddress = "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d";
  console.log("Upgrading DepositRouter on mainnet...");
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
