// Find what contract Upshift's UI actually calls to deposit into the gated vault.
// Approach: scan recent Transfer(from=0x0) events on the share token (= mints).
// The tx.to of the most recent mint is the address we'd need to call to deposit.
require("dotenv").config();
const { JsonRpcProvider, Contract, ZeroAddress } = require("ethers");

const provider = new JsonRpcProvider(process.env.ETHEREUM_RPC_URL, 1);

const VAULTS = [
  ["Upshift High Growth ETH", "0xc824a08db624942c5e5f330d56530cd1598859fd"],
  ["Upshift USDC",            "0x80e1048ede66ec4c364b4f22c8768fc657ff6a42"],
  ["Upshift Core USDC",       "0xe9b725010a9e419412ed67d0fa5f3a5f40159d32"],
  ["Upshift Kelp Gain",       "0xe1b4d34e8754600962cd944b535180bd758e6c2e"],
];

const ABI = ["event Transfer(address indexed from, address indexed to, uint256 value)"];

async function inspect(name, addr) {
  console.log(`\n=== ${name} (${addr}) ===`);
  const c = new Contract(addr, ABI, provider);
  const head = await provider.getBlockNumber();
  // Walk back in chunks until we find at least one mint
  let logs = [];
  let to = head, attempts = 0;
  while (logs.length === 0 && attempts < 6) {
    const from = Math.max(0, to - 50000);
    try {
      logs = await c.queryFilter(c.filters.Transfer(ZeroAddress), from, to);
    } catch (e) {
      console.log(`  err ${from}..${to}: ${e.shortMessage || e.message}`);
      break;
    }
    if (logs.length === 0) { to = from - 1; attempts++; }
  }
  if (logs.length === 0) { console.log("  no recent mints"); return; }
  const recent = logs.slice(-3); // last 3 mints
  for (const ev of recent) {
    const tx = await provider.getTransaction(ev.transactionHash);
    console.log(`  tx ${ev.transactionHash}`);
    console.log(`    block ${ev.blockNumber}, EOA=${tx.from}, to=${tx.to}`);
  }
}

async function main() {
  for (const [n, a] of VAULTS) await inspect(n, a);
}
main().catch(e => { console.error(e); process.exit(1); });
