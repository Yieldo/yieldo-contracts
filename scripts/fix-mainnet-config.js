const hre = require("hardhat");
async function main() {
  const router = await hre.ethers.getContractAt("DepositRouter", "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d");
  // Set minDepositUsd to 0 to skip oracle check for now
  console.log("Setting minDepositUsd to 0...");
  const tx = await router.setMinDepositUsd(0);
  await tx.wait();
  console.log("Done!");
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
