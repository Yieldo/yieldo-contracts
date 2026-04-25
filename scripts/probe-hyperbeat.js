// Probe Hyperbeat share tokens for any getter pointing at the issuance vault.
// Midas mTBILL pattern: share token has a `MINTER_ROLE` granted to the IV.
// The IV's address is sometimes stored in a `vault()`, `minter()`, or
// retrievable via getRoleMember().
require("dotenv").config();
const { JsonRpcProvider, Contract } = require("ethers");

const RPC = process.env.HYPEREVM_RPC_URL || "https://rpc.hyperliquid.xyz/evm";
const provider = new JsonRpcProvider(RPC, 999);

const SHARES = [
  ["lstHYPE",       "0x81e064d0eb539de7c3170edf38c1a42cbd752a76"],
  ["liquidHYPE",    "0x441794d6a8f9a3739f5d4e98a728937b33489d29"],
  ["HyperbeatUSDT", "0x5e105266db42f78fa814322bce7f388b4c2e61eb"],
];

const PROBES = [
  ["name",                "function name() view returns (string)", []],
  ["symbol",              "function symbol() view returns (string)", []],
  ["decimals",            "function decimals() view returns (uint8)", []],
  ["totalSupply",         "function totalSupply() view returns (uint256)", []],
  ["vault",               "function vault() view returns (address)", []],
  ["minter",              "function minter() view returns (address)", []],
  ["owner",               "function owner() view returns (address)", []],
  ["admin",               "function admin() view returns (address)", []],
  ["midasAccessControl",  "function midasAccessControl() view returns (address)", []],
  ["getRoleMember",       "function getRoleMember(bytes32,uint256) view returns (address)",
    ["0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6", 0]],
  ["getRoleMemberCount",  "function getRoleMemberCount(bytes32) view returns (uint256)",
    ["0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6"]],
];

async function probe(name, addr) {
  console.log(`\n=== ${name} (${addr}) ===`);
  for (const [fn, sig, args] of PROBES) {
    try {
      const c = new Contract(addr, [sig], provider);
      const res = await c[fn](...args);
      console.log(`  ${fn.padEnd(22)} = ${res}`);
    } catch (e) {
      // skip misses silently
    }
  }
}

async function main() {
  for (const [n, a] of SHARES) await probe(n, a);
}
main().catch(e => { console.error(e); process.exit(1); });
