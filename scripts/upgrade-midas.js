const hre = require("hardhat");

const ROUTER_PROXY = "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d";

// Midas token → Issuance vault mapping (Ethereum mainnet)
const MIDAS_VAULTS = [
  { name: "Midas Fasanara ONE (mFONE)",  token: "0x238a700eD6165261Cf8b2e544ba797BC11e466Ba", issuance: "0x41438435c20B1C2f1fcA702d387889F346A0C3DE" },
  { name: "Midas mTBILL",                token: "0xDD629E5241CbC5919847783e6C96B2De4754e438", issuance: "0x99361435420711723aF805F08187c9E6bF796683" },
  { name: "Midas Hyperithm (mHYPER)",     token: "0x9b5528528656DBC094765E2abB79F293c21191B9", issuance: "0xbA9FD2850965053Ffab368Df8AA7eD2486f11024" },
  { name: "Midas HyperBTC",              token: "0xC8495EAFf71D3A563b906295fCF2f685b1783085", issuance: "0xeD22A9861C6eDd4f1292aeAb1E44661D5f3FE65e" },
  { name: "Midas Apollo (mAPOLLO)",       token: "0x7CF9DEC92ca9FD46f8d86e7798B72624Bc116C05", issuance: "0xc21511EDd1E6eCdc36e8aD4c82117033e50D5921" },
  { name: "Midas MEV (mMEV)",             token: "0x030b69280892c888670EDCDCD8B69Fd8026A0BF3", issuance: "0xE092737D412E0B290380F9c8548cB5A58174704f" },
  { name: "Midas HyperETH",              token: "0x5a42864b14C0C8241EF5ab62Dae975b163a2E0C1", issuance: "0x57B3Be350C777892611CEdC93BCf8c099A9Ecdab" },
  { name: "Midas RE7 (mRe7YIELD)",        token: "0x87C9053C819bB28e0D73d33059E1b3DA80AFb0cf", issuance: "0xcE0A2953a5d46400Af601a9857235312d1924aC7" },
];

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // Step 1: Deploy new implementation
  console.log("\n1. Deploying new DepositRouter implementation...");
  const Factory = await hre.ethers.getContractFactory("DepositRouter");
  const newImpl = await Factory.deploy();
  await newImpl.waitForDeployment();
  const newImplAddr = await newImpl.getAddress();
  console.log("   New implementation:", newImplAddr);

  // Step 2: Upgrade proxy
  console.log("\n2. Upgrading proxy...");
  const router = await hre.ethers.getContractAt("DepositRouter", ROUTER_PROXY);
  const tx = await router.upgradeToAndCall(newImplAddr, "0x");
  await tx.wait();
  console.log("   Proxy upgraded! TX:", tx.hash);

  // Verify version
  const version = await router.VERSION();
  console.log("   Version:", version);

  // Step 3: Set Midas vault mappings
  console.log("\n3. Setting Midas vault mappings...");
  const tokens = MIDAS_VAULTS.map(v => v.token);
  const issuances = MIDAS_VAULTS.map(v => v.issuance);
  const batchTx = await router.setMidasVaultBatch(tokens, issuances);
  await batchTx.wait();
  console.log("   Batch set! TX:", batchTx.hash);

  // Verify
  console.log("\n4. Verifying...");
  for (const v of MIDAS_VAULTS) {
    const stored = await router.midasVaults(v.token);
    const ok = stored.toLowerCase() === v.issuance.toLowerCase();
    console.log(`   ${v.name}: ${ok ? "OK" : "MISMATCH"} (${stored})`);
  }

  console.log("\nDone! Midas deposits are now supported.");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
