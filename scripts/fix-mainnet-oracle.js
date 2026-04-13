const hre = require("hardhat");
async function main() {
  const router = await hre.ethers.getContractAt("DepositRouter", "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d");
  console.log("Disabling oracle on mainnet (set to address(0))...");
  const tx = await router.setOracle("0x0000000000000000000000000000000000000000");
  await tx.wait();
  console.log("Oracle disabled. USD values will be 0 but deposits work.");
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
