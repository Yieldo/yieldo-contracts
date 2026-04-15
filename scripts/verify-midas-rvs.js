const hre = require("hardhat");

const CANDIDATES = {
  mFONE:      { token: "0x238a700eD6165261Cf8b2e544ba797BC11e466Ba", rv: "0x44b0440e35c596e858cEA433D0d82F5a985fD19C" },
  mTBILL:     { token: "0xDD629E5241CbC5919847783e6C96B2De4754e438", rv: "0xac14a14f578C143625Fc8F54218911e8F634184D" },
  mTBILL_alt: { token: "0xDD629E5241CbC5919847783e6C96B2De4754e438", rv: "0x569D7dccBF6923350521ecBC28A555A500c4f0Ec" },
  mHYPER:     { token: "0x9b5528528656DBC094765E2abB79F293c21191B9", rv: "0x6Be2f55816efd0d91f52720f096006d63c366e98" },
  HyperBTC:   { token: "0xC8495EAFf71D3A563b906295fCF2f685b1783085", rv: "0x16d4f955B0aA1b1570Fe3e9bB2f8c19C407cdb67" },
  mAPOLLO:    { token: "0x7CF9DEC92ca9FD46f8d86e7798B72624Bc116C05", rv: "0x5aeA6D35ED7B3B7aE78694B7da2Ee880756Af5C0" },
  mMEV:       { token: "0x030b69280892c888670EDCDCD8B69Fd8026A0BF3", rv: "0xac14a14f578C143625Fc8F54218911e8F634184D" },
  mHyperETH:  { token: "0x5a42864b14C0C8241EF5ab62Dae975b163a2E0C1", rv: "0x15f724b35A75F0c28F352b952eA9D1b24e348c57" },
  mRe7YIELD:  { token: "0x87C9053C819bB28e0D73d33059E1b3DA80AFb0cf", rv: "0x5356B8E06589DE894D86B24F4079c629E8565234" },
};

const RV_ABI = [
  "function mToken() view returns (address)",
  "function paused() view returns (bool)",
  "function minAmount() view returns (uint256)",
  "function instantFee() view returns (uint256)",
  "function tokensConfig(address) view returns (address dataFeed, uint256 fee, uint256 allowance, bool stable)",
];

async function main() {
  const p = hre.ethers.provider;
  console.log("Verifying Midas RV candidates by querying mToken()...\n");
  const confirmed = {};

  for (const [name, { token, rv }] of Object.entries(CANDIDATES)) {
    const c = new hre.ethers.Contract(rv, RV_ABI, p);
    let mToken, paused, minAmount;
    try { mToken = await c.mToken(); } catch { mToken = null; }
    try { paused = await c.paused(); } catch { paused = null; }
    try { minAmount = (await c.minAmount()).toString(); } catch { minAmount = "—"; }

    const match = mToken && mToken.toLowerCase() === token.toLowerCase();
    console.log(`${name}: ${rv}`);
    console.log(`  mToken():   ${mToken || "(no fn)"}  ${match ? "✓ MATCH" : "✗ mismatch"}`);
    console.log(`  paused:     ${paused === null ? "(no fn)" : paused}`);
    console.log(`  minAmount:  ${minAmount}`);

    if (match) confirmed[token] = rv;
    console.log("");
  }

  console.log("\n=== Confirmed RVs (use for setMidasRedemptionVaultBatch) ===");
  const t = Object.keys(confirmed);
  const r = Object.values(confirmed);
  console.log("tokens:", JSON.stringify(t));
  console.log("rvs:   ", JSON.stringify(r));
  console.log(`\n${t.length} of ${Object.keys(CANDIDATES).filter(k => !k.endsWith("_alt")).length} confirmed`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
