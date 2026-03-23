const hre = require("hardhat");
async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying PythOracle on mainnet...");
  console.log("Deployer:", deployer.address);

  const PythOracle = await hre.ethers.getContractFactory("PythOracle");
  const pythAddress = "0x4305FB66699C3B2702D4d05CF36551390A4c69C6";
  const priceMaxAge = 300;
  const oracle = await PythOracle.deploy(pythAddress, priceMaxAge, deployer.address);
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log("PythOracle deployed:", oracleAddr);

  const feeds = [
    { name: "USDC", asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", feedId: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a" },
    { name: "USDT", asset: "0xdAC17F958D2ee523a2206206994597C13D831ec7", feedId: "0x2b89b9dc8fdf9f34592c9b02cfa78aab1be94e6f05fa0d46c67e6e9e30e34070" },
    { name: "WETH", asset: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", feedId: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace" },
    { name: "WBTC", asset: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", feedId: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43" },
    { name: "PYUSD", asset: "0x6c3ea9036406852006290770BEdFcAbA0e23A0e8", feedId: "0xc1da1b73d7f01e7ddd54b3766cf7571c700d868c403f3872e8bd8c3d523f8148" },
  ];

  console.log("Setting price feeds...");
  const tx = await oracle.setPriceFeedsBatch(feeds.map(f => f.asset), feeds.map(f => f.feedId));
  await tx.wait();
  feeds.forEach(f => console.log("  " + f.name + ": " + f.asset));

  const router = await hre.ethers.getContractAt("DepositRouter", "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d");
  console.log("Setting oracle on router...");
  const setTx = await router.setOracle(oracleAddr);
  await setTx.wait();
  console.log("Oracle set to:", oracleAddr);

  console.log("\nVerify PythOracle:");
  console.log("npx hardhat verify --network mainnet " + oracleAddr + " " + pythAddress + " " + priceMaxAge + " " + deployer.address);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
