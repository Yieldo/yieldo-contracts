const hre = require("hardhat");

async function main() {
  const network = hre.network.name;
  const proxyAddress = network === "mainnet"
    ? "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d"
    : "0xF6B7723661d52E8533c77479d3cad534B4D147Aa";

  const [deployer] = await hre.ethers.getSigners();
  console.log(`Upgrading DepositRouter on ${network} -> V2.5.2 (configurable referral split)`);
  console.log("Proxy:    ", proxyAddress);
  console.log("Deployer: ", deployer.address);

  console.log("\n1. Deploying new implementation...");
  const Factory = await hre.ethers.getContractFactory("DepositRouter");
  const impl = await Factory.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log("   Implementation:", implAddr);

  console.log("\n2. upgradeToAndCall(impl, reinitializeV4())...");
  const router = await hre.ethers.getContractAt("DepositRouter", proxyAddress);
  const initData = Factory.interface.encodeFunctionData("reinitializeV4", []);
  const tx = await router.upgradeToAndCall(implAddr, initData, { gasLimit: 200000 });
  console.log("   tx:", tx.hash);
  await tx.wait();

  console.log("\n3. Verify:");
  console.log("   VERSION:          ", await router.VERSION());
  console.log("   referralSplitBps: ", (await router.referralSplitBps()).toString());
  console.log("\nDone.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
