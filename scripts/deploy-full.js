/**
 * Full deployment script for new chains.
 * Deploys DepositRouter proxy + PythOracle + sets price feeds + signer in one go.
 *
 * Usage:
 *   PRIVATE_KEY=0x... npx hardhat run scripts/deploy-full.js --network arbitrum
 *   PRIVATE_KEY=0x... npx hardhat run scripts/deploy-full.js --network optimism
 */
const hre = require("hardhat");

const PYTH_ADDRESSES = {
  mainnet: "0x4305FB66699C3B2702D4d05CF36551390A4c69C6",
  arbitrum: "0xff1a0f4744e8582DF1aE09D5611b887B6a12925C",
  base: "0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a",
  avalanche: "0x4305FB66699C3B2702D4d05CF36551390A4c69C6",
  optimism: "0xff1a0f4744e8582DF1aE09D5611b887B6a12925C",
};

const PRICE_FEEDS = {
  42161: [
    { name: "USDC", asset: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", feedId: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a" },
    { name: "USDT", asset: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", feedId: "0x2b89b9dc8fdf9f34592c9b02cfa78aab1be94e6f05fa0d46c67e6e9e30e34070" },
  ],
  10: [
    { name: "USDC", asset: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", feedId: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a" },
  ],
};

const FEE_COLLECTOR = process.env.FEE_COLLECTOR || "0xBEb2986BD5b7ADDB360D0BbdAD9a7DE21854F427";
const SIGNER = process.env.SIGNER || "0xfec5605bbe005BE171E1F0fC3C8d4d90f05a0fDa";
const FEE_BPS = 10; // 0.1%

async function main() {
  const networkName = hre.network.name;
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const [deployer] = await hre.ethers.getSigners();

  console.log("=== Full DepositRouter Deployment ===");
  console.log("Network:", networkName, "(chain", chainId, ")");
  console.log("Deployer:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(balance), "ETH");

  if (balance === 0n) {
    console.error("ERROR: Account has no ETH.");
    process.exit(1);
  }

  const pythAddress = PYTH_ADDRESSES[networkName];
  if (!pythAddress) {
    console.error("ERROR: No Pyth address for network:", networkName);
    process.exit(1);
  }

  // --- Step 1: Deploy proxy with V1 initialize ---
  console.log("\n[1/5] Deploying DepositRouter proxy...");
  const DepositRouter = await hre.ethers.getContractFactory("DepositRouter");
  const proxy = await hre.upgrades.deployProxy(
    DepositRouter,
    [FEE_COLLECTOR, pythAddress],
    { kind: "uups", unsafeAllow: ["constructor"] }
  );
  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();
  const implV1 = await hre.upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log("   Proxy:", proxyAddress);
  console.log("   Implementation V1:", implV1);

  // --- Step 2: Deploy PythOracle adapter ---
  console.log("\n[2/5] Deploying PythOracle adapter...");
  const PythOracle = await hre.ethers.getContractFactory("PythOracle");
  const pythOracle = await PythOracle.deploy(pythAddress, 300, deployer.address);
  await pythOracle.waitForDeployment();
  const pythOracleAddress = await pythOracle.getAddress();
  console.log("   PythOracle:", pythOracleAddress);

  // --- Step 3: Set price feeds ---
  const feeds = PRICE_FEEDS[chainId];
  if (feeds && feeds.length > 0) {
    console.log(`\n[3/5] Setting ${feeds.length} price feeds...`);
    feeds.forEach(f => console.log(`   ${f.name}: ${f.asset}`));
    const tx = await pythOracle.setPriceFeedsBatch(
      feeds.map(f => f.asset),
      feeds.map(f => f.feedId)
    );
    await tx.wait();
    console.log("   Done.");
  } else {
    console.log("\n[3/5] No price feeds for chain", chainId, "— skipping.");
  }

  // --- Step 4: Upgrade to V2 (reinitialize with PythOracle + feeBps) ---
  console.log("\n[4/5] Upgrading to V2 (reinitialize with oracle + fees)...");
  const upgradedV2 = await hre.upgrades.upgradeProxy(proxyAddress, DepositRouter, {
    unsafeAllow: ["constructor"],
    unsafeSkipStorageCheck: true,
    call: { fn: "reinitialize", args: [pythOracleAddress, FEE_BPS] },
  });
  await upgradedV2.waitForDeployment();
  console.log("   V2 upgrade complete.");

  // --- Step 5: Upgrade to V3 (reinitializeV3 with signer) ---
  console.log("\n[5/5] Upgrading to V3 (set backend signer)...");
  const upgradedV3 = await hre.upgrades.upgradeProxy(proxyAddress, DepositRouter, {
    unsafeAllow: ["constructor"],
    unsafeSkipStorageCheck: true,
    call: { fn: "reinitializeV3", args: [SIGNER] },
  });
  await upgradedV3.waitForDeployment();
  const finalImpl = await upgradedV3.getImplementation();
  console.log("   V3 upgrade complete.");
  console.log("   Final implementation:", finalImpl);

  // Verify signer
  const signerOnChain = await upgradedV3.signer();
  console.log("   Signer:", signerOnChain);

  // --- Summary ---
  console.log("\n=== Deployment Complete ===");
  const summary = {
    network: networkName,
    chainId,
    proxy: proxyAddress,
    implementation: finalImpl,
    pythOracle: pythOracleAddress,
    feeCollector: FEE_COLLECTOR,
    signer: SIGNER,
    feeBps: FEE_BPS,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(summary, null, 2));

  const explorers = {
    mainnet: "https://etherscan.io",
    arbitrum: "https://arbiscan.io",
    base: "https://basescan.org",
    optimism: "https://optimistic.etherscan.io",
    avalanche: "https://snowtrace.io",
  };
  const explorer = explorers[networkName] || "https://etherscan.io";

  console.log(`\nExplorer: ${explorer}/address/${proxyAddress}`);
  console.log("\nNext steps:");
  console.log(`  1. Add to API constants.py:  ${chainId}: "${proxyAddress}"`);
  console.log(`  2. Add Pyth address:         ${chainId}: "${PYTH_ADDRESSES[networkName]}"`);
  console.log(`  3. Verify contract: npx hardhat verify --network ${networkName} ${finalImpl}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
