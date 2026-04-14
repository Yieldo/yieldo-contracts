const hre = require("hardhat");

const ROUTER = "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

// Midas mTBILL
const MTBILL_TOKEN = "0xDD629E5241CbC5919847783e6C96B2De4754e438";
const MTBILL_IV = "0x99361435420711723aF805F08187c9E6bF796683";

// Midas access-control / greenlist selectors (from Midas public contracts)
const IV_ABI = [
  "function paused() view returns (bool)",
  "function instantFee() view returns (uint256)",
  "function minAmount() view returns (uint256)",
  "function variationTolerance() view returns (uint256)",
  "function tokensReceiver() view returns (address)",
  "function mToken() view returns (address)",
  "function greenlistEnabled() view returns (bool)",
  "function greenlistToggler() view returns (address)",
  "function accessControl() view returns (address)",
  "function tokensConfig(address) view returns (address dataFeed, uint256 fee, uint256 allowance, bool stable)",
  "function depositInstant(address,uint256,uint256,bytes32) external",
];

const AC_ABI = [
  "function hasRole(bytes32,address) view returns (bool)",
  "function GREENLISTED_ROLE() view returns (bytes32)",
  "function BLACKLISTED_ROLE() view returns (bytes32)",
];

async function main() {
  const p = hre.ethers.provider;
  const iv = new hre.ethers.Contract(MTBILL_IV, IV_ABI, p);

  console.log("IV:", MTBILL_IV);

  const check = async (label, fn) => {
    try { const v = await fn(); console.log(`  ${label}:`, v.toString ? v.toString() : v); return v; }
    catch (e) { console.log(`  ${label}: ERR ${e.shortMessage || e.message?.slice(0,120)}`); return null; }
  };

  const paused = await check("paused", () => iv.paused());
  await check("minAmount (scaled 1e18)", () => iv.minAmount());
  await check("instantFee (bps*100?)", () => iv.instantFee());
  await check("variationTolerance", () => iv.variationTolerance());
  await check("mToken", () => iv.mToken());
  await check("tokensReceiver", () => iv.tokensReceiver());
  const greenOn = await check("greenlistEnabled", () => iv.greenlistEnabled());
  const ac = await check("accessControl", () => iv.accessControl());
  await check("tokensConfig[USDC]", () => iv.tokensConfig(USDC));

  if (ac) {
    const acC = new hre.ethers.Contract(ac, AC_ABI, p);
    const GREEN = await check("GREENLISTED_ROLE", () => acC.GREENLISTED_ROLE()).catch(() => null);
    const BLACK = await check("BLACKLISTED_ROLE", () => acC.BLACKLISTED_ROLE()).catch(() => null);
    if (GREEN) {
      const routerGreen = await acC.hasRole(GREEN, ROUTER);
      console.log(`  Router is GREENLISTED: ${routerGreen}`);
    }
    if (BLACK) {
      const routerBlack = await acC.hasRole(BLACK, ROUTER);
      console.log(`  Router is BLACKLISTED: ${routerBlack}`);
    }
  }

  // Simulate with various amounts to find the rounding cliff
  const tests = [
    { label: "1 USDC",     amt: 1_000_000n },
    { label: "10 USDC",    amt: 10_000_000n },
    { label: "100 USDC",   amt: 100_000_000n },
    { label: "1000 USDC",  amt: 1_000_000_000n },
    { label: "1000.5 USDC",amt: 1_000_500_000n },
    { label: "10000 USDC", amt: 10_000_000_000n },
  ];
  console.log("\nSimulating depositInstant(USDC, amt, 0, 0x00) as msg.sender=ROUTER:");
  for (const t of tests) {
    try {
      const data = iv.interface.encodeFunctionData("depositInstant", [USDC, t.amt, 0n, hre.ethers.ZeroHash]);
      await p.call({ from: ROUTER, to: MTBILL_IV, data });
      console.log(`  ${t.label}: OK`);
    } catch (e) {
      const msg = e.shortMessage || e.reason || e.message?.slice(0, 200);
      console.log(`  ${t.label}: REVERT — ${msg}`);
    }
  }

  // Try with non-zero minReceiveAmount
  console.log("\nWith minReceiveAmount=1 wei:");
  try {
    const data = iv.interface.encodeFunctionData("depositInstant", [USDC, 1_000_000_000n, 1n, hre.ethers.ZeroHash]);
    await p.call({ from: ROUTER, to: MTBILL_IV, data });
    console.log("  OK");
  } catch (e) {
    console.log("  REVERT —", e.shortMessage || e.reason || e.message?.slice(0, 200));
  }

  // Try as an EOA user (not router) — to see if msg.sender matters
  console.log("\nSame call, but msg.sender = EOA (0x7E14...41a, deployer):");
  try {
    const data = iv.interface.encodeFunctionData("depositInstant", [USDC, 1_000_000_000n, 0n, hre.ethers.ZeroHash]);
    await p.call({ from: "0x7E14104e2433fDe49C98008911298F069C9dE41a", to: MTBILL_IV, data });
    console.log("  OK — so msg.sender being router isn't the problem");
  } catch (e) {
    console.log("  REVERT —", e.shortMessage || e.reason || e.message?.slice(0, 200));
  }

  // Check the USDC dataFeed
  console.log("\nUSDC dataFeed health (0x3aAc6fd73fA4e16Ec683BD4aaF5Ec89bb2C0EdC2):");
  const DF_ABI = [
    "function getDataInBase18() view returns (uint256)",
    "function aggregator() view returns (address)",
    "function healthyDiff() view returns (uint256)",
  ];
  const df = new hre.ethers.Contract("0x3aAc6fd73fA4e16Ec683BD4aaF5Ec89bb2C0EdC2", DF_ABI, p);
  await check("getDataInBase18", () => df.getDataInBase18());
  await check("aggregator", () => df.aggregator());
  await check("healthyDiff", () => df.healthyDiff());

  // Try base18-scaled amount — Midas expects amountToken in base18, not token decimals
  console.log("\nSimulating with amountToken in BASE18 (1000 USDC → 1000e18):");
  try {
    const data = iv.interface.encodeFunctionData("depositInstant", [USDC, 1000_000000000000000000n, 0n, hre.ethers.ZeroHash]);
    await p.call({ from: ROUTER, to: MTBILL_IV, data });
    console.log("  OK — confirms fix: amountToken must be in base18");
  } catch (e) {
    console.log("  REVERT —", e.shortMessage || e.reason || e.message?.slice(0, 200));
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
