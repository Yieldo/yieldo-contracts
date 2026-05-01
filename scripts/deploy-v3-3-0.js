// Deploy V3.3.0 (post-audit-fix) impl + upgrade existing proxy + handoff
// ownership to the Safe multisig. Skips katana (Safe still activating).
//
// Usage: npx hardhat run scripts/deploy-v3-3-0.js --network <name>
//
// Per-chain flow:
//   1. Deploy new V3.3.0 impl
//   2. upgradeToAndCall(impl, "0x")    -- pure impl swap, no reinitializer
//   3. transferOwnership(SAFE)
//   4. (off-chain) Safe signs acceptOwnership() to claim
//
// Notes:
//   - Most deployed proxies are at _initialized=4 from prior upgrades, so the
//     audit-reviewed initializeV4 reinitializer(4) cannot run. Calling it would
//     revert. The RG NOT_ENTERED seed (audit M-02) is a minor gas optimization
//     for the first-call cost; the contract is fully functional without it
//     (slot starts at 0, first nonReentrant pays one extra 0->NOT_ENTERED SSTORE).
//   - After upgrade, owner should call seedLidoRouteCount(vaults[], assets[])
//     once with all pre-existing (vault, asset) pairs that have non-zero lido
//     queues to sync the M-01 mutex counter with current state.

const hre = require("hardhat");

const SAFE = "0x25DDB6a1a32986E097dCEF257d9006d9583d6232";

const PROXIES = {
  mainnet:     "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d",
  base:        "0xF6B7723661d52E8533c77479d3cad534B4D147Aa",
  arbitrum:    "0xC5700f4D8054BA982C39838D7C33442f54688bd2",
  optimism:    "0x7554937Aa95195D744A6c45E0fd7D4F95A2F8F72",
  monad:       "0xCD8dfD627A3712C9a2B079398e0d524970D5E73F",
  hyperliquid: "0xa682CD1c2Fd7c8545b401824096A600C2bD98F69",
  katana:      "0xa682CD1c2Fd7c8545b401824096A600C2bD98F69",
};

const PROXY_ABI = [
  "function upgradeToAndCall(address,bytes) payable",
  "function transferOwnership(address newOwner)",
  "function acceptOwnership()",
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function VERSION() view returns (string)",
  "function getImplementation() view returns (address)",
];

async function main() {
  const network = hre.network.name;
  const proxy = PROXIES[network];
  if (!proxy) throw new Error(`No proxy registered for '${network}' (skipped or unsupported)`);

  const [deployer] = await hre.ethers.getSigners();
  console.log(`\n=== V3.3.0 audit-fix upgrade on ${network} ===`);
  console.log("Deployer:", deployer.address);
  console.log("Proxy:   ", proxy);
  console.log("Safe:    ", SAFE);

  const c = new hre.ethers.Contract(proxy, PROXY_ABI, deployer);

  // ── Pre-flight ────────────────────────────────────────────────────────
  let beforeVersion;
  try { beforeVersion = await c.VERSION(); } catch { beforeVersion = "<unreadable>"; }
  let beforeOwner;
  try { beforeOwner = await c.owner(); } catch { beforeOwner = "<unreadable>"; }
  let beforeImpl;
  try { beforeImpl = await c.getImplementation(); } catch { beforeImpl = "<unreadable>"; }

  console.log("\n[pre] VERSION:", beforeVersion);
  console.log("[pre] owner:  ", beforeOwner);
  console.log("[pre] impl:   ", beforeImpl);

  if (beforeOwner.toLowerCase() === SAFE.toLowerCase()) {
    console.log("\n⚠ Owner is already the Safe. Cannot transferOwnership from this signer.");
    if (beforeVersion === "3.3.0") {
      console.log("   VERSION is already 3.3.0. Nothing to do. Exiting.");
      return;
    }
    console.log("   Run upgrade through the Safe instead.");
    return;
  } else if (beforeOwner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(
      `owner (${beforeOwner}) is neither the Safe nor the current deployer (${deployer.address}). Cannot proceed.`
    );
  }

  // ── 1. Deploy new impl ────────────────────────────────────────────────
  console.log("\n[1] Deploying V3.3.0 impl...");
  const DR = await hre.ethers.getContractFactory("DepositRouter");
  const impl = await DR.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log("    Impl:", implAddr);

  // ── 2. upgradeToAndCall(impl, "0x") ──────────────────────────────────
  if (beforeVersion === "3.3.0") {
    console.log("\n[2] VERSION already 3.3.0 — skipping upgrade call.");
  } else {
    console.log("\n[2] upgradeToAndCall (no init payload)...");
    const tx2 = await c.upgradeToAndCall(implAddr, "0x");
    console.log("    tx:", tx2.hash);
    await tx2.wait();

    const afterVersion = await c.VERSION();
    console.log("    VERSION after:", afterVersion);
    if (afterVersion !== "3.3.0") {
      throw new Error(`Expected VERSION=3.3.0, got ${afterVersion}`);
    }
  }

  // ── 3. transferOwnership(SAFE) ───────────────────────────────────────
  const currentOwner = await c.owner();
  if (currentOwner.toLowerCase() === SAFE.toLowerCase()) {
    console.log("\n[3] Owner is already Safe. Skipping transferOwnership.");
  } else {
    const currentPending = await c.pendingOwner();
    if (currentPending.toLowerCase() === SAFE.toLowerCase()) {
      console.log("\n[3] Safe is already pendingOwner. Skipping transferOwnership.");
    } else {
      console.log("\n[3] transferOwnership(SAFE)...");
      const tx3 = await c.transferOwnership(SAFE);
      console.log("    tx:", tx3.hash);
      await tx3.wait();
      console.log("    pendingOwner:", await c.pendingOwner());
    }
  }

  // ── 4. Verify impl on block explorer ─────────────────────────────────
  console.log("\n[4] Verifying impl on explorer...");
  try {
    await hre.run("verify:verify", { address: implAddr, constructorArguments: [] });
    console.log("    verified");
  } catch (e) {
    console.log("    verify skipped/failed:", (e.message || "").slice(0, 200));
  }

  console.log("\n=== Done ===");
  console.log(`Proxy:        ${proxy}`);
  console.log(`Impl:         ${implAddr}`);
  console.log(`Owner:        ${await c.owner()} (still EOA until Safe accepts)`);
  console.log(`pendingOwner: ${await c.pendingOwner()}`);
  console.log("");
  console.log("NEXT STEP: Have the Safe sign acceptOwnership() on the proxy via:");
  console.log("  https://app.safe.global  (queue a transaction to)");
  console.log(`  to:   ${proxy}`);
  console.log("  data: 0x79ba5097  (acceptOwnership() selector, no args)");
  console.log("");
}

main().catch((e) => { console.error("\n❌", e.message || e); process.exit(1); });
