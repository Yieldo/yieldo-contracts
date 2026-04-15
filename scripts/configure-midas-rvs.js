/**
 * Configure Midas RedemptionVault addresses on the DepositRouter.
 * Run AFTER upgrading to V2.6 (which adds midasRedemptionVaults mapping).
 *
 *   npx hardhat run scripts/configure-midas-rvs.js --network mainnet
 *
 * All addresses verified on mainnet via scripts/verify-midas-rvs.js (each RV's
 * mToken() view returns the matching share token).
 */
const hre = require("hardhat");

const ROUTER = "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d";

const MIDAS_RVS = [
  { name: "mFONE",     token: "0x238a700eD6165261Cf8b2e544ba797BC11e466Ba", rv: "0x44b0440e35c596e858cEA433D0d82F5a985fD19C" },
  { name: "mTBILL",    token: "0xDD629E5241CbC5919847783e6C96B2De4754e438", rv: "0x569D7dccBF6923350521ecBC28A555A500c4f0Ec" },
  { name: "mHYPER",    token: "0x9b5528528656DBC094765E2abB79F293c21191B9", rv: "0x6Be2f55816efd0d91f52720f096006d63c366e98" },
  { name: "HyperBTC",  token: "0xC8495EAFf71D3A563b906295fCF2f685b1783085", rv: "0x16d4f955B0aA1b1570Fe3e9bB2f8c19C407cdb67" },
  { name: "mAPOLLO",   token: "0x7CF9DEC92ca9FD46f8d86e7798B72624Bc116C05", rv: "0x5aeA6D35ED7B3B7aE78694B7da2Ee880756Af5C0" },
  { name: "mMEV",      token: "0x030b69280892c888670EDCDCD8B69Fd8026A0BF3", rv: "0xac14a14f578C143625Fc8F54218911e8F634184D" },
  { name: "mHyperETH", token: "0x5a42864b14C0C8241EF5ab62Dae975b163a2E0C1", rv: "0x15f724b35A75F0c28F352b952eA9D1b24e348c57" },
  { name: "mRe7YIELD", token: "0x87C9053C819bB28e0D73d33059E1b3DA80AFb0cf", rv: "0x5356B8E06589DE894D86B24F4079c629E8565234" },
];

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const router = await hre.ethers.getContractAt("DepositRouter", ROUTER);
  const version = await router.VERSION();
  console.log("Router:", ROUTER, "| version:", version);
  if (!version.startsWith("2.6") && !version.startsWith("2.5.3") && parseFloat(version) < 2.6) {
    console.log("WARNING: router version < 2.6, midasRedemptionVaults mapping may not exist yet.");
  }

  const tokens = MIDAS_RVS.map(x => x.token);
  const rvs = MIDAS_RVS.map(x => x.rv);

  console.log("\nCalling setMidasRedemptionVaultBatch...");
  const tx = await router.setMidasRedemptionVaultBatch(tokens, rvs);
  console.log("tx:", tx.hash);
  await tx.wait();

  console.log("\nVerification:");
  for (const { name, token, rv } of MIDAS_RVS) {
    const stored = await router.midasRedemptionVaults(token);
    const ok = stored.toLowerCase() === rv.toLowerCase();
    console.log(`  ${name.padEnd(10)} ${ok ? "OK" : "MISMATCH"}  (stored: ${stored})`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
