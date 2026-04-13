const hre = require("hardhat");

const PYTH_ADDRESSES = {
  mainnet: "0x4305FB66699C3B2702D4d05CF36551390A4c69C6",
  arbitrum: "0xff1a0f4744e8582DF1aE09D5611b887B6a12925C",
  base: "0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a",
  avalanche: "0x4305FB66699C3B2702D4d05CF36551390A4c69C6",
};

async function main() {
  console.log("Deploying DepositRouter (UUPS Proxy)...");
  console.log("Network:", hre.network.name);

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  const nativeTokens = { mainnet: 'ETH', avalanche: 'AVAX', arbitrum: 'ETH', base: 'ETH' };
  const nativeToken = nativeTokens[hre.network.name] || 'ETH';
  console.log("Account balance:", hre.ethers.formatEther(balance), nativeToken);

  if (balance === 0n) {
    console.error(`ERROR: Account has no ${nativeToken}.`);
    process.exit(1);
  }

  const pythAddress = PYTH_ADDRESSES[hre.network.name];
  if (!pythAddress) {
    console.error("ERROR: No Pyth address for network:", hre.network.name);
    process.exit(1);
  }

  const FEE_COLLECTOR = process.env.FEE_COLLECTOR || "0xBEb2986BD5b7ADDB360D0BbdAD9a7DE21854F427";
  console.log("Fee Collector:", FEE_COLLECTOR);
  console.log("Pyth Oracle:", pythAddress);

  const DepositRouter = await hre.ethers.getContractFactory("DepositRouter");

  console.log("\nDeploying proxy (this may take 1-2 minutes)...");
  const proxy = await hre.upgrades.deployProxy(
    DepositRouter,
    [FEE_COLLECTOR, pythAddress],
    {
      kind: "uups",
      unsafeAllow: ["constructor"],
    }
  );

  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();
  const implAddress = await hre.upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log("\nProxy deployed to:", proxyAddress);
  console.log("Implementation deployed to:", implAddress);

  const explorers = {
    mainnet: "https://etherscan.io",
    avalanche: "https://snowtrace.io",
    arbitrum: "https://arbiscan.io",
    base: "https://basescan.org",
  };
  const explorer = explorers[hre.network.name] || explorers.mainnet;

  console.log("\nDeployment Info:");
  console.log(JSON.stringify({
    network: hre.network.name,
    proxy: proxyAddress,
    implementation: implAddress,
    pyth: pythAddress,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
  }, null, 2));

  console.log("\nNext steps:");
  console.log(`1. Update DEPOSIT_ROUTER_ADDRESS to: ${proxyAddress}`);
  console.log(`2. Verify: CONTRACT_ADDRESS=${proxyAddress} npx hardhat run scripts/verify.js --network ${hre.network.name}`);
  console.log(`3. View proxy: ${explorer}/address/${proxyAddress}`);
  console.log(`\nTo upgrade later: npx hardhat run scripts/upgrade.js --network ${hre.network.name}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
