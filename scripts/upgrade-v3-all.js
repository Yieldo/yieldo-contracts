const hre = require("hardhat");

const PROXIES = {
  mainnet:     "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d",
  arbitrum:    "0xC5700f4D8054BA982C39838D7C33442f54688bd2",
  optimism:    "0x7554937Aa95195D744A6c45E0fd7D4F95A2F8F72",
  monad:       "0xCD8dfD627A3712C9a2B079398e0d524970D5E73F",
  katana:      "0xa682CD1c2Fd7c8545b401824096A600C2bD98F69",
  // hyperliquid: no proxy deployed yet
};

async function main() {
  const networkName = hre.network.name;
  const proxyAddress = PROXIES[networkName];
  if (!proxyAddress) {
    console.error(`No proxy address for network: ${networkName}`);
    console.log("Available:", Object.keys(PROXIES).join(", "));
    process.exit(1);
  }

  const [deployer] = await hre.ethers.getSigners();
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  console.log(`\n=== Upgrading to V3 on ${networkName} (chain ${chainId}) ===`);
  console.log("Proxy:", proxyAddress);
  console.log("Deployer:", deployer.address);

  // Step 1: Force-import proxy if not registered
  const DepositRouter = await hre.ethers.getContractFactory("DepositRouter");
  try {
    await hre.upgrades.forceImport(proxyAddress, DepositRouter, { kind: "uups" });
    console.log("Proxy registered in manifest");
  } catch (e) {
    if (e.message.includes("already registered") || e.message.includes("already imported")) {
      console.log("Proxy already registered");
    } else {
      console.log("Force-import note:", e.message.slice(0, 80));
    }
  }

  // Step 2: Deploy new implementation
  console.log("Deploying V3 implementation...");
  const impl = await DepositRouter.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log("Implementation deployed at:", implAddr);
  console.log("Implementation VERSION:", await impl.VERSION());

  // Step 3: Upgrade proxy
  console.log("Upgrading proxy...");
  const proxy = await hre.ethers.getContractAt(
    ["function upgradeToAndCall(address,bytes) external", "function VERSION() view returns (string)"],
    proxyAddress, deployer
  );
  const tx = await proxy.upgradeToAndCall(implAddr, "0x");
  await tx.wait();
  console.log("Proxy upgraded! tx:", tx.hash);

  // Step 4: Verify
  const version = await proxy.VERSION();
  console.log("Proxy VERSION:", version);

  console.log(JSON.stringify({
    network: networkName, chainId, proxy: proxyAddress,
    implementation: implAddr, version, tx: tx.hash,
    timestamp: new Date().toISOString(),
  }, null, 2));

  console.log(`\nVerify: npx hardhat verify --network ${networkName} ${implAddr}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
