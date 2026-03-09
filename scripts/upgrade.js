const hre = require("hardhat");

const PYTH_ADDRESSES = {
  mainnet: "0x4305FB66699C3B2702D4d05CF36551390A4c69C6",
  arbitrum: "0xff1a0f4744e8582DF1aE09D5611b887B6a12925C",
  base: "0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a",
  avalanche: "0x4305FB66699C3B2702D4d05CF36551390A4c69C6",
};

const PRICE_FEEDS = {
  8453: [
    { name: "USDC", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", feedId: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a" },
    { name: "WETH", asset: "0x4200000000000000000000000000000000000006", feedId: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace" },
  ],
  1: [
    { name: "USDC", asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", feedId: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a" },
    { name: "USDT", asset: "0xdAC17F958D2ee523a2206206994597C13D831ec7", feedId: "0x2b89b9dc8fdf9f34592c9b02cfa78aab1be94e6f05fa0d46c67e6e9e30e34070" },
    { name: "WETH", asset: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", feedId: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace" },
    { name: "WBTC", asset: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", feedId: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43" },
    { name: "PYUSD", asset: "0x6c3ea9036406852006290770BEdFcAbA0e23A0e8", feedId: "0xc1da1b73d7f01e7ddd54b3766cf7571c700d868c403f3872e8bd8c3d523f8148" },
  ],
  42161: [
    { name: "USDC", asset: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", feedId: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a" },
    { name: "USDT", asset: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", feedId: "0x2b89b9dc8fdf9f34592c9b02cfa78aab1be94e6f05fa0d46c67e6e9e30e34070" },
  ],
};

async function main() {
  const proxyAddress = process.env.CONTRACT_ADDRESS;
  if (!proxyAddress) {
    console.error("Set CONTRACT_ADDRESS env var to the proxy address");
    process.exit(1);
  }

  const [deployer] = await hre.ethers.getSigners();
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const networkName = hre.network.name;

  console.log("Upgrading DepositRouter to V2...");
  console.log("Network:", networkName, "(chain", chainId, ")");
  console.log("Proxy:", proxyAddress);
  console.log("Deployer:", deployer.address);

  // --- Step 1: Deploy PythOracle adapter ---
  const pythAddress = PYTH_ADDRESSES[networkName];
  if (!pythAddress) {
    console.error("No Pyth address for network:", networkName);
    process.exit(1);
  }

  console.log("\n1. Deploying PythOracle adapter...");
  const PythOracle = await hre.ethers.getContractFactory("PythOracle");
  const priceMaxAge = 300; // 5 minutes
  const pythOracle = await PythOracle.deploy(pythAddress, priceMaxAge, deployer.address);
  await pythOracle.waitForDeployment();
  const pythOracleAddress = await pythOracle.getAddress();
  console.log("   PythOracle deployed to:", pythOracleAddress);

  // --- Step 2: Set price feeds on PythOracle ---
  const feeds = PRICE_FEEDS[chainId];
  if (feeds && feeds.length > 0) {
    console.log(`\n2. Setting ${feeds.length} price feeds on PythOracle...`);
    feeds.forEach(f => console.log(`   ${f.name}: ${f.asset}`));
    const assets = feeds.map(f => f.asset);
    const feedIds = feeds.map(f => f.feedId);
    const feedTx = await pythOracle.setPriceFeedsBatch(assets, feedIds);
    await feedTx.wait();
    console.log("   Price feeds set.");
  } else {
    console.log("\n2. No price feeds configured for chain", chainId);
  }

  // --- Step 3: Upgrade proxy with reinitialize call ---
  console.log("\n3. Upgrading proxy + calling reinitialize...");
  const DepositRouter = await hre.ethers.getContractFactory("DepositRouter");

  const feeBps = 10; // 0.1%

  const upgraded = await hre.upgrades.upgradeProxy(proxyAddress, DepositRouter, {
    unsafeAllow: ["constructor"],
    unsafeSkipStorageCheck: true,
    call: {
      fn: "reinitialize",
      args: [pythOracleAddress, feeBps],
    },
  });
  await upgraded.waitForDeployment();

  const newImpl = await upgraded.getImplementation();
  console.log("   Upgraded! New implementation:", newImpl);
  console.log("   Proxy address unchanged:", proxyAddress);

  // --- Summary ---
  console.log("\n=== Upgrade Summary ===");
  console.log(JSON.stringify({
    network: networkName,
    chainId,
    proxy: proxyAddress,
    newImplementation: newImpl,
    pythOracle: pythOracleAddress,
    pythAddress,
    feeBps,
    priceMaxAge,
    timestamp: new Date().toISOString(),
  }, null, 2));

  console.log("\nNext steps:");
  console.log(`  - Verify PythOracle: npx hardhat verify --network ${networkName} ${pythOracleAddress} ${pythAddress} ${priceMaxAge} ${deployer.address}`);
  console.log(`  - Verify impl: CONTRACT_ADDRESS=${proxyAddress} npx hardhat run scripts/verify.js --network ${networkName}`);
  console.log("  - (Optional) Enable vault whitelist: setVaultWhitelistEnabled(true) + setVaultAllowed(...)");
  console.log("  - (Optional) Transfer PythOracle ownership to multisig");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
