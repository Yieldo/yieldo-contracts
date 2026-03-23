const hre = require("hardhat");
async function main() {
  const router = await hre.ethers.getContractAt("DepositRouter", "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d");
  const VEDA_VAULT = "0x08c6F91e2B681FaF5e17227F2a44C307b3C1364C";
  const VEDA_TELLER = "0x4DE413a26fC24c3FC27Cc983be70aA9c5C299387";

  const current = await router.vedaTellers(VEDA_VAULT);
  if (current === "0x0000000000000000000000000000000000000000") {
    console.log("Setting Veda teller for Liquid USD...");
    const tx = await router.setVedaTeller(VEDA_VAULT, VEDA_TELLER);
    await tx.wait();
    console.log("Done! Teller set to:", VEDA_TELLER);
  } else {
    console.log("Teller already set:", current);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
