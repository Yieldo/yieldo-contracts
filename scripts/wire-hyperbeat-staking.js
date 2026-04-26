// Deploy HyperbeatStakingAdapter on HyperEVM and wire lstHYPE.
// (liquidHYPE will follow once we confirm same signature.)
//
//   lstHYPE share token        = 0x81e064d0eB539de7c3170EDF38C1A42CBd752A76
//   lstHYPE Insurance Contract = 0x205aC1e0380B0b9ccE691bd4C6f3c14258Ae9201  (decoded from tx 0xc06ece57…)
const hre = require("hardhat");
const { ethers } = hre;

const ROUTER  = "0xa682CD1c2Fd7c8545b401824096A600C2bD98F69"; // HyperEVM router
const LST_SHARE = "0x81e064d0eB539de7c3170EDF38C1A42CBd752A76";
const LST_IC    = "0x205aC1e0380B0b9ccE691bd4C6f3c14258Ae9201";

const ROUTER_ABI = [
  "function owner() view returns (address)",
  "function vaultAdapters(address) view returns (address)",
  "function setVaultAdapter(address vault, address adapter)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("deployer:", signer.address);
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, signer);
  const owner = await router.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) throw new Error("not router owner");

  console.log("\n[1/3] Deploying HyperbeatStakingAdapter...");
  const Adapter = await ethers.getContractFactory("HyperbeatStakingAdapter");
  const adapter = await Adapter.deploy(signer.address);
  await adapter.waitForDeployment();
  const adapterAddr = await adapter.getAddress();
  console.log("  adapter:", adapterAddr);

  console.log("\n[2/3] setInsuranceContract(lstHYPE, IC)...");
  const tx1 = await adapter.setInsuranceContract(LST_SHARE, LST_IC);
  await tx1.wait();
  console.log("  tx:", tx1.hash);

  console.log("\n[3/3] router.setVaultAdapter(lstHYPE, adapter)...");
  const tx2 = await router.setVaultAdapter(LST_SHARE, adapterAddr);
  await tx2.wait();
  console.log("  tx:", tx2.hash);

  console.log("\nVerification:");
  console.log("  router.vaultAdapters(lstHYPE):", await router.vaultAdapters(LST_SHARE));
  console.log("  adapter.insuranceContracts(lstHYPE):", await adapter.insuranceContracts(LST_SHARE));
  console.log("\nlstHYPE wired. Adapter:", adapterAddr);
  console.log("(Re-use the same adapter for liquidHYPE once we have its IC — just call setInsuranceContract on it.)");
}
main().catch(e => { console.error(e); process.exit(1); });
