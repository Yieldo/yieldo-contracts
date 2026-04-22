// Fresh-compile V3.1.0 impl, upgrade proxy via direct upgradeToAndCall, and set LiFi callers.
// Bypasses OZ upgrade plugin (it was re-using stale impl addresses).
//
// Usage: npx hardhat run scripts/deploy-v3-1-full.js --network <name>
const hre = require("hardhat");

const PROXIES = {
  mainnet:  "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d",
  base:     "0xF6B7723661d52E8533c77479d3cad534B4D147Aa",
  arbitrum: "0xC5700f4D8054BA982C39838D7C33442f54688bd2",
  optimism: "0x7554937Aa95195D744A6c45E0fd7D4F95A2F8F72",
  monad:    "0xCD8dfD627A3712C9a2B079398e0d524970D5E73F",
  katana:   "0xa682CD1c2Fd7c8545b401824096A600C2bD98F69",
};

// Addresses checksummed via ethers.getAddress() at runtime below to avoid manual typos.
const LIFI_EXECUTOR_CURRENT = "0x4dac9d1769b9b304cb04741dcdeb2fc14abdf110";
const LIFI_EXECUTOR_LEGACY  = "0x2dc0e2aa608532da689e89e237df582b783e5408";
const LIFI_DIAMOND          = "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae";

const AUTHORIZED_BOOTSTRAP = {
  mainnet:  [LIFI_EXECUTOR_CURRENT, LIFI_EXECUTOR_LEGACY, LIFI_DIAMOND],
  base:     [LIFI_EXECUTOR_CURRENT, LIFI_EXECUTOR_LEGACY, LIFI_DIAMOND],
  arbitrum: [LIFI_EXECUTOR_CURRENT, LIFI_EXECUTOR_LEGACY, LIFI_DIAMOND],
  optimism: [LIFI_EXECUTOR_CURRENT, LIFI_EXECUTOR_LEGACY, LIFI_DIAMOND],
  monad:    [],
  katana:   [],
};

async function main() {
  const network = hre.network.name;
  const proxy = PROXIES[network];
  if (!proxy) throw new Error(`No proxy for network '${network}'`);

  const [deployer] = await hre.ethers.getSigners();
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  console.log(`\n=== V3.1.0 Full Upgrade on ${network} (chain ${chainId}) ===`);
  console.log("Deployer:", deployer.address);
  console.log("Proxy:   ", proxy);
  const bal = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance: ", hre.ethers.formatEther(bal), "ETH");

  // Low-priority fee override for mainnet
  if (network === "mainnet") {
    const feeData = await hre.ethers.provider.getFeeData();
    const basefee = feeData.gasPrice || feeData.maxFeePerGas || 0n;
    const basefeeGwei = Number(hre.ethers.formatUnits(basefee, "gwei"));
    console.log("Basefee: ", basefeeGwei.toFixed(2), "gwei");
    if (basefeeGwei > 8) { console.log("Basefee > 8 gwei. Abort."); process.exit(1); }
  }

  const ROUTER_ABI = [
    "function VERSION() view returns (string)",
    "function upgradeToAndCall(address newImplementation, bytes calldata data) external payable",
    "function authorizedCallers(address) view returns (bool)",
    "function setAuthorizedCallerBatch(address[] calldata callers, bool[] calldata authorized) external",
  ];

  const proxyC = new hre.ethers.Contract(proxy, ROUTER_ABI, deployer);

  // Read current VERSION (via raw call to avoid ABI-decoder caching)
  async function readVersion() {
    const res = await hre.ethers.provider.call({ to: proxy, data: "0xffa1ad74" });
    if (res === "0x") return "<none>";
    try { return hre.ethers.AbiCoder.defaultAbiCoder().decode(["string"], res)[0]; }
    catch { return "<undecodable>"; }
  }

  const versionBefore = await readVersion();
  console.log("\n[1/3] VERSION before:", versionBefore);

  if (versionBefore === "3.1.0") {
    console.log("    Already on 3.1.0 — skipping impl deploy + upgrade.");
  } else {
    console.log("\n[2/3] Deploying fresh V3.1.0 implementation...");
    const DR = await hre.ethers.getContractFactory("DepositRouter");
    const impl = await DR.deploy();
    await impl.waitForDeployment();
    const implAddr = await impl.getAddress();
    console.log("    New impl:", implAddr);

    console.log("\n    Calling upgradeToAndCall...");
    const tx = await proxyC.upgradeToAndCall(implAddr, "0x");
    console.log("    tx:", tx.hash);
    await tx.wait();
    console.log("    VERSION after:", await readVersion());
  }

  // Authorize LiFi callers
  const toAuthorize = AUTHORIZED_BOOTSTRAP[network] || [];
  if (toAuthorize.length === 0) {
    console.log("\n[3/3] No composer callers to authorize (two-step only chain).");
  } else {
    console.log(`\n[3/3] Authorizing ${toAuthorize.length} composer caller(s):`);
    const needed = [];
    const flags = [];
    for (const lowerA of toAuthorize) {
      const a = hre.ethers.getAddress(lowerA);
      const already = await proxyC.authorizedCallers(a);
      console.log(`    ${a} — ${already ? "already" : "pending"}`);
      if (!already) { needed.push(a); flags.push(true); }
    }
    if (needed.length > 0) {
      const batchTx = await proxyC.setAuthorizedCallerBatch(needed, flags);
      console.log("    batch tx:", batchTx.hash);
      await batchTx.wait();
    }
  }

  console.log("\nDone.");
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
