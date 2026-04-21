const hre = require("hardhat");

async function main() {
  const proxyAddress = "0xF6B7723661d52E8533c77479d3cad534B4D147Aa";
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying V3 implementation manually...");
  console.log("Deployer:", deployer.address);

  const DepositRouter = await hre.ethers.getContractFactory("DepositRouter");
  const impl = await DepositRouter.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log("New implementation deployed at:", implAddr);

  // Verify it's V3
  const v = await impl.VERSION();
  console.log("Implementation VERSION:", v);

  // Upgrade proxy manually via upgradeToAndCall
  const proxy = await ethers.getContractAt(
    ["function upgradeToAndCall(address newImpl, bytes data) external"],
    proxyAddress
  );
  const tx = await proxy.upgradeToAndCall(implAddr, "0x");
  await tx.wait();
  console.log("Proxy upgraded! tx:", tx.hash);

  // Verify
  const router = await ethers.getContractAt(
    ["function VERSION() view returns (string)", "function getImplementation() view returns (address)"],
    proxyAddress
  );
  console.log("Proxy VERSION:", await router.VERSION());
  console.log("Proxy implementation:", await router.getImplementation());
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
