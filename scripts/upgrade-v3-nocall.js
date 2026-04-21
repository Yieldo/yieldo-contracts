const hre = require("hardhat");

async function main() {
  const proxyAddress = process.env.CONTRACT_ADDRESS;
  const [deployer] = await hre.ethers.getSigners();
  console.log("Upgrading to V3 (no reinitializer call)...");
  console.log("Proxy:", proxyAddress, "Deployer:", deployer.address);

  const DepositRouter = await hre.ethers.getContractFactory("DepositRouter");
  const upgraded = await hre.upgrades.upgradeProxy(proxyAddress, DepositRouter, {
    unsafeAllow: ["constructor"],
    unsafeSkipStorageCheck: true,
  });
  await upgraded.waitForDeployment();
  const newImpl = await upgraded.getImplementation();
  const version = await upgraded.VERSION();
  console.log("Upgraded! Impl:", newImpl, "Version:", version);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
