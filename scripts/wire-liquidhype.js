// Wire liquidHYPE on the already-deployed HyperbeatStakingAdapter.
// Just two cheap txs: setInsuranceContract on adapter + setVaultAdapter on router.
const hre = require("hardhat");
const { ethers } = hre;

const ROUTER  = "0xa682CD1c2Fd7c8545b401824096A600C2bD98F69";
const ADAPTER = "0xaaFCe6529B936707cF7DC806E551Ea9384C080E8";
const SHARE   = "0x441794d6a8f9a3739f5d4e98a728937b33489d29"; // liquidHYPE
const IC      = "0x5bfb09Dd155C0Ec3f375B266A7353c0bA64F9d60"; // decoded from tx 0x89904164…

const ROUTER_ABI = ["function setVaultAdapter(address vault, address adapter)", "function vaultAdapters(address) view returns (address)"];
const ADAPTER_ABI = ["function setInsuranceContract(address shareToken, address ic)", "function insuranceContracts(address) view returns (address)"];

async function main() {
  const [signer] = await ethers.getSigners();
  const router  = new ethers.Contract(ROUTER, ROUTER_ABI, signer);
  const adapter = new ethers.Contract(ADAPTER, ADAPTER_ABI, signer);

  console.log("[1/2] adapter.setInsuranceContract(liquidHYPE, IC)…");
  const tx1 = await adapter.setInsuranceContract(SHARE, IC);
  await tx1.wait();
  console.log("  tx:", tx1.hash);

  console.log("[2/2] router.setVaultAdapter(liquidHYPE, adapter)…");
  const tx2 = await router.setVaultAdapter(SHARE, ADAPTER);
  await tx2.wait();
  console.log("  tx:", tx2.hash);

  console.log("\n✓ Wired:");
  console.log("  router.vaultAdapters(liquidHYPE):", await router.vaultAdapters(SHARE));
  console.log("  adapter.insuranceContracts(liquidHYPE):", await adapter.insuranceContracts(SHARE));
}
main().catch(e => { console.error(e); process.exit(1); });
