// Deploy V3.2.0 impl + upgrade + verify. Skips mainnet.
// Usage: npx hardhat run scripts/deploy-v3-2-0.js --network <name>
const hre = require("hardhat");

const PROXIES = {
  base:        "0xF6B7723661d52E8533c77479d3cad534B4D147Aa",
  arbitrum:    "0xC5700f4D8054BA982C39838D7C33442f54688bd2",
  optimism:    "0x7554937Aa95195D744A6c45E0fd7D4F95A2F8F72",
  monad:       "0xCD8dfD627A3712C9a2B079398e0d524970D5E73F",
  hyperliquid: "0xa682CD1c2Fd7c8545b401824096A600C2bD98F69",
  katana:      "0xa682CD1c2Fd7c8545b401824096A600C2bD98F69",
};

async function main() {
  const network = hre.network.name;
  const proxy = PROXIES[network];
  if (!proxy) throw new Error(`No proxy for '${network}'`);

  const [deployer] = await hre.ethers.getSigners();
  console.log(`\n=== V3.2.0 Upgrade on ${network} ===`);
  console.log("Deployer:", deployer.address);
  console.log("Proxy:   ", proxy);

  async function readVersion() {
    const res = await hre.ethers.provider.call({ to: proxy, data: "0xffa1ad74" });
    if (res === "0x") return "<none>";
    try { return hre.ethers.AbiCoder.defaultAbiCoder().decode(["string"], res)[0]; }
    catch { return "<undecodable>"; }
  }

  const before = await readVersion();
  console.log("\n[1] VERSION before:", before);
  if (before === "3.2.0") { console.log("    Already 3.2.0. Skipping."); return; }

  console.log("\n[2] Deploying impl...");
  const DR = await hre.ethers.getContractFactory("DepositRouter");
  const impl = await DR.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log("    Impl:", implAddr);

  console.log("\n[3] upgradeToAndCall...");
  const ABI = ["function upgradeToAndCall(address,bytes) payable"];
  const c = new hre.ethers.Contract(proxy, ABI, deployer);
  const tx = await c.upgradeToAndCall(implAddr, "0x");
  console.log("    tx:", tx.hash);
  await tx.wait();
  console.log("    VERSION after:", await readVersion());

  console.log("\n[4] Verifying impl...");
  try {
    await hre.run("verify:verify", { address: implAddr, constructorArguments: [] });
    console.log("    verified");
  } catch (e) {
    console.log("    verify skipped/failed:", (e.message || "").slice(0, 200));
  }
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
