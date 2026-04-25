// Redeploy UpshiftAdapter (now with orchestrator mapping), unset old wiring,
// set new wiring keyed by SHARE TOKEN.
const hre = require("hardhat");
const { ethers } = hre;

const ROUTER       = "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d";
const NUSD_ORCH    = "0xAEEb2fB279a5aA837367B9D2582F898a63b06ca1"; // orchestrator
const NUSD_SHARE   = "0xd852a101B7C6e0C647C8418A763394A37Dd72bCa"; // share token
const OLD_ADAPTER  = "0xF7Fd92f3292BC6e69f22d46FDfF3ff3b3C14c66e"; // v1 wired to orchestrator (wrong)

const ROUTER_ABI = [
  "function owner() view returns (address)",
  "function vaultAdapters(address) view returns (address)",
  "function setVaultAdapter(address vault, address adapter)",
];

const MAX_FEE = ethers.parseUnits("0.5", "gwei");
const PRIORITY = ethers.parseUnits("0.01", "gwei");
const txOpts = { maxFeePerGas: MAX_FEE, maxPriorityFeePerGas: PRIORITY };

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("deployer:", signer.address);
  const before = await signer.provider.getBalance(signer.address);
  const baseFee = (await signer.provider.getBlock("latest")).baseFeePerGas || 0n;
  console.log("ETH:", ethers.formatEther(before), "| baseFee:", ethers.formatUnits(baseFee, "gwei"), "gwei");

  const router = new ethers.Contract(ROUTER, ROUTER_ABI, signer);

  // 1. Deploy v2 adapter
  console.log("\n[1/4] Deploying UpshiftAdapter v2...");
  const Adapter = await ethers.getContractFactory("UpshiftAdapter");
  const adapter = await Adapter.deploy(signer.address, txOpts);
  await adapter.waitForDeployment();
  const adapterAddr = await adapter.getAddress();
  console.log("  v2 adapter:", adapterAddr);
  console.log("  deploy tx:", adapter.deploymentTransaction().hash);

  // 2. Set orchestrator mapping inside the adapter
  console.log("\n[2/4] Setting orchestrator mapping in adapter (NUSD_share -> NUSD_orch)...");
  const setOrchTx = await adapter.setOrchestrator(NUSD_SHARE, NUSD_ORCH, txOpts);
  console.log("  tx:", setOrchTx.hash);
  await setOrchTx.wait();

  // 3. Unset old wiring on router (orchestrator address as key — wrong)
  console.log("\n[3/4] Unwiring old adapter from orchestrator address on router...");
  const unsetTx = await router.setVaultAdapter(NUSD_ORCH, ethers.ZeroAddress, txOpts);
  console.log("  tx:", unsetTx.hash);
  await unsetTx.wait();

  // 4. Wire NEW adapter on router keyed by SHARE TOKEN
  console.log("\n[4/4] Wiring v2 adapter on router (keyed by NUSD share token)...");
  const wireTx = await router.setVaultAdapter(NUSD_SHARE, adapterAddr, txOpts);
  console.log("  tx:", wireTx.hash);
  await wireTx.wait();

  // Verify
  const linkedShare = await router.vaultAdapters(NUSD_SHARE);
  const linkedOrch  = await router.vaultAdapters(NUSD_ORCH);
  console.log("\nVerification:");
  console.log("  router.vaultAdapters(NUSD_SHARE) =", linkedShare);
  console.log("  router.vaultAdapters(NUSD_ORCH)  =", linkedOrch, "(should be 0x0)");
  if (linkedShare.toLowerCase() !== adapterAddr.toLowerCase()) throw new Error("v2 wiring failed");
  if (linkedOrch !== ethers.ZeroAddress) throw new Error("old wiring not removed");

  const after = await signer.provider.getBalance(signer.address);
  console.log("\nGas spent:", ethers.formatEther(before - after), "ETH");
  console.log("Old adapter (now disconnected):", OLD_ADAPTER);
  console.log("New adapter (live):", adapterAddr);
}

main().catch(e => { console.error(e); process.exit(1); });
