const hre = require("hardhat");

async function main() {
  const proxyAddress = process.env.CONTRACT_ADDRESS;
  if (!proxyAddress) {
    console.error("Set CONTRACT_ADDRESS env var to the proxy address");
    process.exit(1);
  }

  console.log("Upgrading DepositRouter...");
  console.log("Network:", hre.network.name);
  console.log("Proxy:", proxyAddress);

  const DepositRouter = await hre.ethers.getContractFactory("DepositRouter");

  const upgraded = await hre.upgrades.upgradeProxy(proxyAddress, DepositRouter, {
    unsafeAllow: ["constructor"],
  });
  await upgraded.waitForDeployment();

  const newImpl = await upgraded.getImplementation();
  console.log("Upgraded! New implementation:", newImpl);
  console.log("Proxy address unchanged:", proxyAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
