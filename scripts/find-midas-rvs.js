/**
 * Find Midas RedemptionVault (RV) addresses for each configured mToken.
 *
 * Approach: scan recent Transfer(from, 0x0, amount) events on the mToken
 * (= burns triggered by redemption). The tx sender / to-field is typically
 * the RV (for EOA-initiated redemptions). For tx.to that looks like a router
 * or aggregator, we skip and keep scanning until we find a direct redeemer.
 *
 * Usage: npx hardhat run scripts/find-midas-rvs.js --network mainnet
 */
const hre = require("hardhat");

const MIDAS_TOKENS = [
  { name: "mFONE",   addr: "0x238a700eD6165261Cf8b2e544ba797BC11e466Ba" },
  { name: "mTBILL",  addr: "0xDD629E5241CbC5919847783e6C96B2De4754e438" },
  { name: "mHYPER",  addr: "0x9b5528528656DBC094765E2abB79F293c21191B9" },
  { name: "HyperBTC", addr: "0xC8495EAFf71D3A563b906295fCF2f685b1783085" },
  { name: "mAPOLLO", addr: "0x7CF9DEC92ca9FD46f8d86e7798B72624Bc116C05" },
  { name: "mMEV",    addr: "0x030b69280892c888670EDCDCD8B69Fd8026A0BF3" },
  { name: "mHyperETH", addr: "0x5a42864b14C0C8241EF5ab62Dae975b163a2E0C1" },
  { name: "mRe7YIELD", addr: "0x87C9053C819bB28e0D73d33059E1b3DA80AFb0cf" },
];

const IV_FOR_TOKEN = {
  "0x238a700eD6165261Cf8b2e544ba797BC11e466Ba": "0x41438435c20B1C2f1fcA702d387889F346A0C3DE",
  "0xDD629E5241CbC5919847783e6C96B2De4754e438": "0x99361435420711723aF805F08187c9E6bF796683",
  "0x9b5528528656DBC094765E2abB79F293c21191B9": "0xbA9FD2850965053Ffab368Df8AA7eD2486f11024",
  "0xC8495EAFf71D3A563b906295fCF2f685b1783085": "0xeD22A9861C6eDd4f1292aeAb1E44661D5f3FE65e",
  "0x7CF9DEC92ca9FD46f8d86e7798B72624Bc116C05": "0xc21511EDd1E6eCdc36e8aD4c82117033e50D5921",
  "0x030b69280892c888670EDCDCD8B69Fd8026A0BF3": "0xE092737D412E0B290380F9c8548cB5A58174704f",
  "0x5a42864b14C0C8241EF5ab62Dae975b163a2E0C1": "0x57B3Be350C777892611CEdC93BCf8c099A9Ecdab",
  "0x87C9053C819bB28e0D73d33059E1b3DA80AFb0cf": "0xcE0A2953a5d46400Af601a9857235312d1924aC7",
};

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_TOPIC = "0x" + "0".repeat(64);

async function findRV(p, token) {
  const latest = await p.getBlockNumber();
  const CHUNK = 9_500;
  const MAX_CHUNKS = 60;  // ~570k blocks back (~2 months on mainnet)

  const candidates = new Map();

  for (let i = 0; i < MAX_CHUNKS; i++) {
    const to = latest - i * CHUNK;
    const from = to - CHUNK + 1;
    let logs;
    try {
      logs = await p.getLogs({
        address: token.addr,
        topics: [TRANSFER_TOPIC, null, ZERO_TOPIC],
        fromBlock: from, toBlock: to,
      });
    } catch {
      continue;
    }
    for (const log of logs) {
      try {
        const tx = await p.getTransaction(log.transactionHash);
        if (!tx || !tx.to) continue;
        const addr = tx.to;
        if (addr.toLowerCase() === IV_FOR_TOKEN[token.addr]?.toLowerCase()) continue;
        if (["0x1111111254EEB25477B68fb85Ed929f73A960582"].includes(addr)) continue;
        candidates.set(addr, (candidates.get(addr) || 0) + 1);
      } catch {}
    }
    if (candidates.size >= 2) break;  // enough signal
  }

  const sorted = [...candidates.entries()].sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, 3);
}

async function probe(p, addr) {
  // Verify the candidate exposes redeemInstant(address,uint256,uint256)
  try {
    const selector = hre.ethers.id("redeemInstant(address,uint256,uint256)").slice(0, 10);
    // Eth_call with malformed args — if the function exists, we get a revert with reason
    // If it doesn't exist, we get 0x returndata with no revert string
    const bogus = selector + "0".repeat(64 * 3);
    await p.call({ to: addr, data: bogus });
    return "exists (did not revert — suspicious)";
  } catch (e) {
    const msg = e.shortMessage || e.message || "";
    if (msg.includes("MV:") || msg.includes("RV:") || msg.includes("DV:")) return "confirmed (Midas error)";
    if (msg.includes("execution reverted")) return "likely (reverted with data)";
    return "unclear: " + msg.slice(0, 80);
  }
}

async function main() {
  const p = hre.ethers.provider;
  const network = hre.network.name;
  console.log(`Finding Midas RVs on ${network}...\n`);

  const results = {};
  for (const token of MIDAS_TOKENS) {
    console.log(`${token.name} (${token.addr}):`);
    const candidates = await findRV(p, token);
    if (candidates.length === 0) {
      console.log("  no burn events found in recent ranges");
      results[token.addr] = null;
      continue;
    }
    for (const [addr, count] of candidates) {
      const check = await probe(p, addr);
      console.log(`  ${addr}  [${count} burn calls]  -> ${check}`);
    }
    results[token.addr] = candidates[0][0];
    console.log("");
  }

  console.log("\n=== setMidasRedemptionVaultBatch args ===");
  const tokens = [];
  const rvs = [];
  for (const [t, rv] of Object.entries(results)) {
    if (rv) { tokens.push(t); rvs.push(rv); }
  }
  console.log("tokens:", JSON.stringify(tokens));
  console.log("rvs:   ", JSON.stringify(rvs));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
