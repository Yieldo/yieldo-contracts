// Manually point proxy -> freshly-deployed impl via upgradeTo.
// Usage: NEW_IMPL=0x... PROXY=0x... npx hardhat run scripts/manual-upgrade.js --network <name>
const hre = require("hardhat");

async function main() {
  const proxy = process.env.PROXY;
  const newImpl = process.env.NEW_IMPL;
  if (!proxy || !newImpl) throw new Error("Set PROXY=0x... NEW_IMPL=0x...");

  const [deployer] = await hre.ethers.getSigners();
  console.log("Network:   ", hre.network.name);
  console.log("Deployer:  ", deployer.address);
  console.log("Proxy:     ", proxy);
  console.log("New impl:  ", newImpl);

  // Gas caps for mainnet
  if (hre.network.name === "mainnet") {
    const feeData = await hre.ethers.provider.getFeeData();
    const basefee = feeData.gasPrice || feeData.maxFeePerGas || 0n;
    console.log("Basefee:   ", hre.ethers.formatUnits(basefee, "gwei"), "gwei");
    if (Number(hre.ethers.formatUnits(basefee, "gwei")) > 8) {
      console.log("Basefee too high. Abort.");
      process.exit(1);
    }
  }

  const ABI = [
    "function upgradeToAndCall(address newImplementation, bytes calldata data) external payable",
    "function VERSION() view returns (string)",
  ];
  const c = new hre.ethers.Contract(proxy, ABI, deployer);
  console.log("\nVERSION before:", await c.VERSION());

  const tx = await c.upgradeToAndCall(newImpl, "0x");
  console.log("\nUpgrade tx:", tx.hash);
  await tx.wait();

  console.log("VERSION after: ", await c.VERSION());
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
