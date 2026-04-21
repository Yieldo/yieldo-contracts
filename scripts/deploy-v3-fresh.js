const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const networkName = hre.network.name;

  console.log(`\n=== Fresh V3 Deploy on ${networkName} (chain ${chainId}) ===`);
  console.log("Deployer:", deployer.address);
  const bal = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(bal));

  const DepositRouter = await hre.ethers.getContractFactory("DepositRouter");

  console.log("Deploying proxy + implementation...");
  const proxy = await hre.upgrades.deployProxy(DepositRouter, [deployer.address], {
    kind: "uups",
    unsafeAllow: ["constructor"],
    initializer: "initializeV3",
  });
  await proxy.waitForDeployment();
  const proxyAddr = await proxy.getAddress();
  const implAddr = await proxy.getImplementation();

  console.log("Proxy:", proxyAddr);
  console.log("Implementation:", implAddr);
  console.log("Owner:", await proxy.owner());
  console.log("VERSION:", await proxy.VERSION());

  console.log("\n" + JSON.stringify({
    network: networkName, chainId,
    proxy: proxyAddr, implementation: implAddr,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
  }, null, 2));

  console.log(`\nVerify: npx hardhat verify --network ${networkName} ${implAddr}`);
  console.log(`\nADD TO constants.py:\n  ${chainId}: "${proxyAddr}",`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
