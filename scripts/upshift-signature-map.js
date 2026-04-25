// For each Upshift vault: simulate BOTH the standard ERC-4626 deposit
// (selector 0x6e553f65) and Upshift's 3-arg deposit (selector 0xf45346dc)
// to map which signature each vault accepts. From EOA so no router/whitelist
// noise.
require("dotenv").config();
const { JsonRpcProvider, getAddress } = require("ethers");

const provider = new JsonRpcProvider(process.env.ETHEREUM_RPC_URL, 1);
const USER = getAddress("0x7E14104e2433fDe49C98008911298F069C9dE41a");

const VAULTS = [
  ["Upshift USDC",            "0x80E1048eDE66ec4c364b4F22C8768fc657FF6A42", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 1_000_000n],            // 1 USDC
  ["Upshift Gamma USDC",      "0x998D7b14c123c1982404562b68edDB057b0477cB", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 1_000_000n],
  ["Upshift Core USDC",       "0xE9B725010A9E419412ed67d0fA5f3A5f40159D32", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 1_000_000n],
  ["Upshift Kelp Gain",       "0xe1B4d34E8754600962Cd944B535180Bd758E6c2e", "0xa1290d69c65a6fe4df752f95823fae25cb99e5a7", 1_000_000_000_000_000_000n],  // 1 rsETH
  ["Upshift NUSD",            "0xAEEb2fB279a5aA837367B9D2582F898a63b06ca1", "0xe556aba6fe6036275ec1f87eda296be72c811bce", 1_000_000_000_000_000_000n],  // 1 NUSD
  ["Upshift High Growth ETH", "0xc824A08dB624942c5e5f330d56530cD1598859fD", "0xa1290d69c65a6fe4df752f95823fae25cb99e5a7", 1_000_000_000_000_000_000n],
];

function pad32(hexNoPrefix) { return hexNoPrefix.padStart(64, "0"); }

async function probe(name, vault, asset, amount) {
  // ERC-4626 standard: deposit(uint256 assets, address receiver)
  const data4626 = "0x6e553f65" +
    pad32(amount.toString(16)) +
    "000000000000000000000000" + USER.slice(2).toLowerCase();

  // Upshift 3-arg: deposit(address asset, uint256 amount, address receiver)
  const data3arg = "0xf45346dc" +
    "000000000000000000000000" + asset.toLowerCase() +
    pad32(amount.toString(16)) +
    "000000000000000000000000" + USER.slice(2).toLowerCase();

  const r4 = await provider.call({ from: USER, to: vault, data: data4626 })
    .then(() => "✓ would succeed")
    .catch(e => {
      const d = e.data || e.info?.error?.data || "";
      if ((e.shortMessage || "").includes("transfer amount exceeds allowance")) return "✓ allowance error (works after approval)";
      if (d.startsWith("0xdeeb6943")) return "✗ DepositsPaused()";
      if (d === "0x" || !d) return "✗ empty revert (selector mismatch / paused)";
      return `? revert ${d.slice(0,10)}`;
    });
  const r3 = await provider.call({ from: USER, to: vault, data: data3arg })
    .then(() => "✓ would succeed")
    .catch(e => {
      const d = e.data || e.info?.error?.data || "";
      if ((e.shortMessage || "").includes("transfer amount exceeds allowance")) return "✓ allowance error (works after approval)";
      if (d.startsWith("0xdeeb6943")) return "✗ DepositsPaused()";
      if (d === "0x" || !d) return "✗ empty revert (selector mismatch / paused)";
      return `? revert ${d.slice(0,10)}`;
    });
  console.log(`  ${name.padEnd(28)}  ERC-4626: ${r4.padEnd(46)}  3-arg: ${r3}`);
}

async function main() {
  console.log("Probing each Upshift vault with both signatures from EOA...\n");
  for (const [n, v, a, amt] of VAULTS) await probe(n, v, a, amt);
}
main().catch(e => { console.error(e); process.exit(1); });
