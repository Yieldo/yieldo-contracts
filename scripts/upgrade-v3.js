const hre = require("hardhat");

async function main() {
  const proxyAddress = process.env.CONTRACT_ADDRESS;
  if (!proxyAddress) {
    console.error("Set CONTRACT_ADDRESS env var to the proxy address");
    process.exit(1);
  }

  const [deployer] = await hre.ethers.getSigners();
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const networkName = hre.network.name;

  console.log("Upgrading DepositRouter to V3.0 (attribution-only)...");
  console.log("Network:", networkName, "(chain", chainId, ")");
  console.log("Proxy:", proxyAddress);
  console.log("Deployer:", deployer.address);

  const DepositRouter = await hre.ethers.getContractFactory("DepositRouter");

  const upgraded = await hre.upgrades.upgradeProxy(proxyAddress, DepositRouter, {
    unsafeAllow: ["constructor"],
    unsafeSkipStorageCheck: true,
    call: {
      fn: "reinitializeV5",
      args: [],
    },
  });
  await upgraded.waitForDeployment();

  const newImpl = await upgraded.getImplementation();
  console.log("Upgraded! New implementation:", newImpl);
  console.log("Proxy address unchanged:", proxyAddress);

  const version = await upgraded.VERSION();
  console.log("Contract version:", version);

  console.log("\n=== Upgrade Summary ===");
  console.log(JSON.stringify({
    network: networkName,
    chainId,
    proxy: proxyAddress,
    newImplementation: newImpl,
    version,
    timestamp: new Date().toISOString(),
  }, null, 2));

  console.log("\nNext steps:");
  console.log(`  - Verify impl: npx hardhat verify --network ${networkName} ${newImpl}`);
  console.log("  - Test depositFor() with a small amount");
  console.log("  - Existing vault configs (Midas, Veda, Lido, adapters) carry over automatically");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
