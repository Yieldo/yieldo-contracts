const hre = require("hardhat");

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
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;
  const feeds = PRICE_FEEDS[Number(chainId)];

  if (!feeds) {
    console.error("No price feeds configured for chain:", chainId.toString());
    process.exit(1);
  }

  const contractAddress = process.env.CONTRACT_ADDRESS;
  if (!contractAddress) {
    console.error("Set CONTRACT_ADDRESS env var");
    process.exit(1);
  }

  const router = await hre.ethers.getContractAt("DepositRouter", contractAddress);

  const assets = feeds.map(f => f.asset);
  const feedIds = feeds.map(f => f.feedId);

  console.log(`Setting ${feeds.length} price feeds on chain ${chainId}...`);
  feeds.forEach(f => console.log(`  ${f.name}: ${f.asset} → ${f.feedId.slice(0, 18)}...`));

  const tx = await router.setPriceFeedsBatch(assets, feedIds);
  console.log("Tx hash:", tx.hash);
  await tx.wait();
  console.log("Price feeds set successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
