// Discover Hyperbeat issuance vault (IV) addresses by scanning recent
// mint events on each share token. The IV is the contract that mints
// the share token to depositors — we find it by looking at who emitted
// the Transfer(from=0x0) event's transaction.
require("dotenv").config();
const { JsonRpcProvider, Contract, ZeroAddress } = require("ethers");

const RPC = process.env.HYPEREVM_RPC_URL || "https://rpc.hyperliquid.xyz/evm";
const provider = new JsonRpcProvider(RPC, 999);

const SHARES = [
  ["lstHYPE",       "0x81e064d0eb539de7c3170edf38c1a42cbd752a76"],
  ["liquidHYPE",    "0x441794d6a8f9a3739f5d4e98a728937b33489d29"],
  ["HyperbeatUSDT", "0x5e105266db42f78fa814322bce7f388b4c2e61eb"],
];

const ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

async function inspect(name, addr, head) {
  console.log(`\n=== ${name} (${addr}) ===`);
  const c = new Contract(addr, ABI, provider);
  const filter = c.filters.Transfer(ZeroAddress);

  // Walk back in chunks until we find at least one mint
  let logs = [];
  let from = head, span = 2000, attempts = 0;
  while (logs.length === 0 && attempts < 8) {
    const to = from;
    from = Math.max(0, to - span);
    try {
      logs = await c.queryFilter(filter, from, to);
    } catch (e) {
      console.log(`  err scanning ${from}..${to}: ${e.shortMessage || e.message}`);
      break;
    }
    if (logs.length === 0) {
      attempts++;
      span *= 2;
    }
  }
  if (logs.length === 0) {
    console.log("  no mint events found in scanned range");
    return;
  }
  // Most recent mint
  const last = logs[logs.length - 1];
  const tx = await provider.getTransaction(last.transactionHash);
  const receipt = await provider.getTransactionReceipt(last.transactionHash);
  console.log(`  last mint tx: ${last.transactionHash}`);
  console.log(`  to (entry contract): ${tx.to}`);
  console.log(`  from (EOA/depositor): ${tx.from}`);
  console.log(`  shares minted to: ${last.args.to}`);
  console.log(`  amount: ${last.args.value.toString()}`);
  // Other contracts involved (one of these is the IV)
  const others = new Set();
  for (const l of receipt.logs) {
    if (l.address.toLowerCase() !== addr.toLowerCase()) others.add(l.address);
  }
  console.log(`  contracts emitting other logs: ${[...others].join(", ") || "(none)"}`);
}

async function main() {
  const head = await provider.getBlockNumber();
  console.log(`HyperEVM head block: ${head}`);
  for (const [name, addr] of SHARES) {
    try { await inspect(name, addr, head); }
    catch (e) { console.log(`  fatal: ${e.shortMessage || e.message}`); }
  }
}
main().catch(e => { console.error("FAILED:", e); process.exit(1); });
