// V3.1.0 upgrade script — runs per-chain via `npx hardhat run scripts/upgrade-v3.1.js --network <name>`.
//
// What this does per chain:
//   1. Deploys a fresh V3.1.0 implementation
//   2. upgradeTo(newImpl) via OZ plugin (unsafeSkipStorageCheck: true — layout verified by hand)
//   3. Bootstraps authorizedCallers with LiFi's canonical Diamond + Executor addresses on chains
//      that use the one-step composer. Chains using only two-step bridging skip this step because
//      msg.sender == user on the destination depositFor call.
//
// Confirmed two-step-only chains (no LiFi whitelist needed):
//   - Katana (747474): LiFi bridging only, user signs depositFor themselves
//   - Monad (143):    all current vaults forced two-step (no composer)
//
// Chains where composer is live → LiFi Diamond + Executor must be whitelisted:
//   - Ethereum, Base, Arbitrum, Optimism
//
// HyperEVM (999): skipped entirely — deploy is pending big-blocks enablement per CLAUDE memory.

const hre = require("hardhat");

const PROXIES = {
  mainnet:   "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d",
  base:      "0xF6B7723661d52E8533c77479d3cad534B4D147Aa",
  arbitrum:  "0xC5700f4D8054BA982C39838D7C33442f54688bd2",
  optimism:  "0x7554937Aa95195D744A6c45E0fd7D4F95A2F8F72",
  monad:     "0xCD8dfD627A3712C9a2B079398e0d524970D5E73F",
  katana:    "0xa682CD1c2Fd7c8545b401824096A600C2bD98F69",
};

// LiFi destination-side addresses — verified from trace of production composer tx
// 0xc73ee1bd...63251 (Monad → Base via Across, April 2026).
//
// Call chain observed: Across relayer → Across SpokePool → LiFi AcrossV4 Receiver
//   → LiFi Executor → YieldoRouter.depositFor(...).
// msg.sender to our router = LiFi Executor.
//
// LiFi Executor is deployed at the same CREATE3 address on every LiFi-supported EVM chain.
// The legacy Executor (0x2dC0E2aa...) and Diamond (0x1231DEB6...) are kept in the whitelist
// for redundancy — if LiFi routes via a non-Across bridge (Stargate, Hop, Celer, etc.) the
// destination caller still lands on the same Executor, but we defensively allow fallbacks.
// The Across-specific Receiver (0x33b255b5...) is NOT the msg.sender — it delegates to Executor.
const LIFI_EXECUTOR_CURRENT = "0x4DaC9d1769b9b304cb04741DCDEb2FC14aBdF110"; // verified on Base
const LIFI_EXECUTOR_LEGACY  = "0x2dC0E2aa608532Da689e89e237dF582B783E5408"; // older CREATE3 variant
const LIFI_DIAMOND          = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE"; // same-chain composer

// Per-chain composer allowlist bootstrap. [] = no LiFi auth (two-step only on that chain).
const AUTHORIZED_BOOTSTRAP = {
  mainnet:  [LIFI_EXECUTOR_CURRENT, LIFI_EXECUTOR_LEGACY, LIFI_DIAMOND],
  base:     [LIFI_EXECUTOR_CURRENT, LIFI_EXECUTOR_LEGACY, LIFI_DIAMOND],
  arbitrum: [LIFI_EXECUTOR_CURRENT, LIFI_EXECUTOR_LEGACY, LIFI_DIAMOND],
  optimism: [LIFI_EXECUTOR_CURRENT, LIFI_EXECUTOR_LEGACY, LIFI_DIAMOND],
  monad:    [],  // two-step only — no composer callers
  katana:   [],  // two-step only — no composer callers
};

async function main() {
  const network = hre.network.name;
  const proxyAddress = PROXIES[network];
  if (!proxyAddress) {
    throw new Error(`No V3.0 proxy for network '${network}'. Use deploy-v3-fresh.js for new chains.`);
  }

  const [deployer] = await hre.ethers.getSigners();
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  console.log(`\n=== V3.1.0 Upgrade on ${network} (chain ${chainId}) ===`);
  console.log("Deployer:", deployer.address);
  console.log("Proxy:   ", proxyAddress);
  console.log("Balance: ", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)));

  // Mainnet: cap priority fee at 0.01 gwei and refuse to broadcast when basefee is high.
  // Keeps the impl-deploy cost under ~0.005 ETH at typical basefees.
  if (network === "mainnet") {
    const feeData = await hre.ethers.provider.getFeeData();
    const basefee = feeData.gasPrice || feeData.maxFeePerGas || 0n;
    const basefeeGwei = Number(hre.ethers.formatUnits(basefee, "gwei"));
    console.log(`Basefee:  ${basefeeGwei.toFixed(2)} gwei`);
    if (basefeeGwei > 8) {
      console.log("Basefee above 8 gwei — refusing to deploy on mainnet at this price.");
      console.log("Re-run when network is quieter (evenings or weekends are typically cheapest).");
      process.exit(1);
    }
    const tip = hre.ethers.parseUnits("0.01", "gwei");
    const maxFee = basefee + tip * 2n;
    hre.ethers.provider.getFeeData = async () => ({
      gasPrice: null,
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: tip,
      lastBaseFeePerGas: basefee,
    });
    console.log(`Gas override: maxPriorityFee=0.01 gwei, maxFee=${hre.ethers.formatUnits(maxFee, "gwei")} gwei`);
  }

  const DepositRouter = await hre.ethers.getContractFactory("DepositRouter");

  // If no .openzeppelin manifest exists for this chain yet, register the proxy first.
  // This happens on chains that were deployed via deploy-v3-fresh.js on a different machine
  // or via a script that didn't persist the manifest. No on-chain effect — local bookkeeping.
  try {
    await hre.upgrades.forceImport(proxyAddress, DepositRouter, { kind: "uups" });
    console.log("    (proxy imported into local manifest)");
  } catch (e) {
    if (!String(e.message || "").match(/already|exists/i)) {
      console.log("    forceImport note:", e.message);
    }
  }

  console.log("\n[1/3] Deploying V3.1.0 implementation + upgrading proxy...");
  const upgraded = await hre.upgrades.upgradeProxy(proxyAddress, DepositRouter, {
    unsafeAllow: ["constructor"],
    unsafeSkipStorageCheck: true,
  });
  await upgraded.waitForDeployment();
  const newImpl = await upgraded.getImplementation();
  console.log("    New implementation:", newImpl);
  console.log("    VERSION on-chain:  ", await upgraded.VERSION());

  console.log("\n[2/3] Sanity read of preserved state...");
  console.log("    owner:                  ", await upgraded.owner());
  console.log("    vaultWhitelistEnabled:  ", await upgraded.vaultWhitelistEnabled());

  const toAuthorize = AUTHORIZED_BOOTSTRAP[network] || [];
  if (toAuthorize.length === 0) {
    console.log("\n[3/3] No composer callers to authorize on this chain (two-step bridging only).");
  } else {
    console.log(`\n[3/3] Authorizing ${toAuthorize.length} composer caller(s):`);
    const needed = [];
    const flags = [];
    for (const a of toAuthorize) {
      const already = await upgraded.authorizedCallers(a);
      console.log(`    ${a} — ${already ? "already authorized" : "pending"}`);
      if (!already) { needed.push(a); flags.push(true); }
    }
    if (needed.length > 0) {
      const tx = await upgraded.setAuthorizedCallerBatch(needed, flags);
      console.log("    batch tx:", tx.hash);
      await tx.wait();
      console.log("    Confirmed.");
    } else {
      console.log("    All already authorized — skipping batch.");
    }
  }

  console.log("\nDone.");
  console.log(`Verify impl:  npx hardhat verify --network ${network} ${newImpl}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
