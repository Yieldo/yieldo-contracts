// Check each Upshift vault for the DepositsPaused() error by simulating a deposit.
require("dotenv").config();
const { JsonRpcProvider } = require("ethers");

const provider = new JsonRpcProvider(process.env.ETHEREUM_RPC_URL, 1);
const ROUTER = "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d";
const USER   = "0x7E14104e2433fDe49C98008911298F069C9dE41a";

// Use realistic amounts that pass any "minimum amount" / "shares > 0" guards
// so we only see pause-related failures, not simulation-amount artifacts.
const VAULTS = [
  ["Upshift USDC",            "0x80e1048ede66ec4c364b4f22c8768fc657ff6a42", 1_000_000_000n],         // 1000 USDC
  ["Upshift Gamma USDC",      "0x998d7b14c123c1982404562b68eddb057b0477cb", 1_000_000_000n],         // 1000 USDC
  ["Upshift Core USDC",       "0xe9b725010a9e419412ed67d0fa5f3a5f40159d32", 1_000_000_000n],         // 1000 USDC
  ["Upshift Kelp Gain",       "0xe1b4d34e8754600962cd944b535180bd758e6c2e", 1_000_000_000_000_000_000n], // 1 rsETH
  ["Upshift NUSD",            "0xaeeb2fb279a5aa837367b9d2582f898a63b06ca1", 1_000_000_000_000_000_000n], // 1 NUSD (18 decimals)
  ["Upshift High Growth ETH", "0xc824a08db624942c5e5f330d56530cd1598859fd", 1_000_000_000_000_000_000n], // 1 rsETH
];

const PAUSED_SELECTOR = "0xdeeb6943"; // DepositsPaused()

function pad(addr) { return "000000000000000000000000" + addr.slice(2).toLowerCase(); }

async function check(name, vault, amount) {
  // selector for deposit(uint256,address) = 0x6e553f65
  const data = "0x6e553f65" +
    amount.toString(16).padStart(64, "0") +
    pad(USER);
  try {
    await provider.call({ from: ROUTER, to: vault, data });
    console.log(`  ✓ ${name.padEnd(28)} — would succeed`);
  } catch (e) {
    const d = e.data || e.info?.error?.data || "";
    if (d.startsWith(PAUSED_SELECTOR)) {
      console.log(`  ✗ ${name.padEnd(28)} — DepositsPaused()`);
    } else {
      console.log(`  ? ${name.padEnd(28)} — revert ${d.slice(0,10)} (${(e.shortMessage || "").slice(0,60)})`);
    }
  }
}

async function main() {
  for (const [n, v, a] of VAULTS) await check(n, v, a);
}
main().catch(e => { console.error(e); process.exit(1); });
