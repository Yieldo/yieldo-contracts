// Deploy UpshiftAdapter on Monad + wire it to Upshift AUSD via the Monad router.
// Run: npx hardhat run scripts/deploy-upshift-adapter-monad.js --network monad
const hre = require("hardhat");
const { ethers } = hre;

const ROUTER     = "0xCD8dfD627A3712C9a2B079398e0d524970D5E73F"; // Monad DepositRouter
const AUSD_ORCH  = "0x36edbf0c834591bfdfcac0ef9605528c75c406aa"; // Upshift AUSD orchestrator
const AUSD_SHARE = "0x103222f020e98Bba0AD9809A011FDF8e6F067496"; // share token (found via direct deposit)

const ROUTER_ABI = [
  "function owner() view returns (address)",
  "function vaultAdapters(address) view returns (address)",
  "function setVaultAdapter(address vault, address adapter)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("deployer:", signer.address);
  const before = await signer.provider.getBalance(signer.address);
  console.log("MON balance:", ethers.formatEther(before));

  const router = new ethers.Contract(ROUTER, ROUTER_ABI, signer);
  const owner = await router.owner();
  console.log("router owner:", owner);
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Signer ${signer.address} is not router owner ${owner}`);
  }

  console.log("\n[1/3] Deploying UpshiftAdapter on Monad...");
  const Adapter = await ethers.getContractFactory("UpshiftAdapter");
  const adapter = await Adapter.deploy(signer.address);
  await adapter.waitForDeployment();
  const adapterAddr = await adapter.getAddress();
  console.log("  UpshiftAdapter:", adapterAddr);
  console.log("  deploy tx:", adapter.deploymentTransaction().hash);

  console.log("\n[2/3] setOrchestrator(AUSD_share -> AUSD_orch)...");
  const setOrchTx = await adapter.setOrchestrator(AUSD_SHARE, AUSD_ORCH);
  console.log("  tx:", setOrchTx.hash);
  await setOrchTx.wait();

  console.log("\n[3/3] setVaultAdapter(AUSD_share, adapter) on Monad router...");
  const wireTx = await router.setVaultAdapter(AUSD_SHARE, adapterAddr);
  console.log("  tx:", wireTx.hash);
  await wireTx.wait();

  const linked = await router.vaultAdapters(AUSD_SHARE);
  console.log("\nVerification:");
  console.log("  router.vaultAdapters(AUSD_SHARE) =", linked);
  if (linked.toLowerCase() !== adapterAddr.toLowerCase()) throw new Error("wiring failed");

  const after = await signer.provider.getBalance(signer.address);
  console.log("\nGas spent:", ethers.formatEther(before - after), "MON");
  console.log("Adapter:", adapterAddr);
}
main().catch(e => { console.error(e); process.exit(1); });
