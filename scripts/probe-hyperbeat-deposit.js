// Probe Hyperbeat vaults: try multiple deposit signatures + look for any
// IV/issuance pointer. We've tried Midas-style getters before; this time
// also try plain ERC-4626 deposit, the 3-arg Upshift-style deposit, and
// scan the share token's recent transfers for clues.
require("dotenv").config();
const { JsonRpcProvider, Contract, id, getAddress } = require("ethers");

const provider = new JsonRpcProvider(process.env.HYPEREVM_RPC_URL || "https://rpc.hyperliquid.xyz/evm", 999);
const TEST = "0x0000000000000000000000000000000000000001";

const VAULTS = [
  ["lstHYPE",       "0x81e064d0eb539de7c3170edf38c1a42cbd752a76"],
  ["liquidHYPE",    "0x441794d6a8f9a3739f5d4e98a728937b33489d29"],
  ["HyperbeatUSDT", "0x5e105266db42f78fa814322bce7f388b4c2e61eb"],
  ["UltraUBTC",     "0x9fdbda0a5e284c32744d2f17ee5c74b284993463"],  // known working for comparison
];

// Try every plausible deposit signature
const SIG_PROBES = [
  ["deposit(uint256,address)",                    "ERC-4626 standard"],
  ["deposit(address,uint256,address)",            "Upshift 3-arg"],
  ["depositInstant(address,uint256,uint256,bytes32)", "Midas instant"],
  ["mint(uint256,address)",                       "ERC-4626 mint"],
  ["requestDeposit(uint256,address,address)",     "ERC-7540 async"],
];

const GETTER_PROBES = [
  "asset()",
  "underlying()",
  "vault()",
  "depositVault()",
  "issuanceVault()",
  "mTokenVault()",
  "depositToken()",
  "wrappedToken()",
  "minter()",
  "manager()",
  "owner()",
  "controller()",
  "factory()",
];

async function probeGetters(addr) {
  const found = {};
  for (const sig of GETTER_PROBES) {
    const sel = id(sig).slice(0, 10);
    try {
      const r = await provider.call({ to: addr, data: sel });
      if (r && r !== "0x" && r.length === 66) {
        const result = "0x" + r.slice(26);
        if (/^0x[0-9a-f]{40}$/i.test(result) && result !== "0x0000000000000000000000000000000000000000") {
          found[sig] = result;
        }
      }
    } catch {}
  }
  return found;
}

async function probeSelectors(addr) {
  const found = [];
  for (const [sig, label] of SIG_PROBES) {
    const sel = id(sig).slice(0, 10);
    // Build a minimal calldata that won't accidentally succeed but will
    // reveal whether the selector is callable (vs reverting empty).
    try {
      // Just call with the selector + zero args — most signatures will
      // revert but with a specific reason if the selector exists.
      const dummy = sel + "0".repeat(64 * 4);
      await provider.call({ from: TEST, to: addr, data: dummy });
      found.push({ sig, label, result: "would succeed (unusual)" });
    } catch (e) {
      const d = e.data || e.info?.error?.data || "";
      const sm = (e.shortMessage || "").slice(0, 60);
      // If selector doesn't exist, often empty revert (function not found)
      // Specific revert = selector exists but our zero-args were rejected
      if (d && d !== "0x") {
        found.push({ sig, label, result: `selector exists, revert: ${d.slice(0, 10)}` });
      } else if (sm.includes("0x")) {
        found.push({ sig, label, result: `selector exists, ${sm}` });
      }
    }
  }
  return found;
}

async function inspect(name, addr) {
  console.log(`\n=== ${name} (${addr}) ===`);
  // Basic
  try {
    const c = new Contract(addr, ["function name() view returns (string)", "function symbol() view returns (string)", "function decimals() view returns (uint8)", "function totalSupply() view returns (uint256)"], provider);
    const [n, s, d, ts] = await Promise.all([c.name().catch(() => "?"), c.symbol().catch(() => "?"), c.decimals().catch(() => 0n), c.totalSupply().catch(() => 0n)]);
    console.log(`  name: ${n} | symbol: ${s} | decimals: ${d} | supply: ${ts}`);
  } catch {}
  // Getter scan
  const getters = await probeGetters(addr);
  if (Object.keys(getters).length) {
    console.log("  getters that returned an address:");
    for (const [g, r] of Object.entries(getters)) console.log(`    ${g.padEnd(22)} -> ${r}`);
  } else {
    console.log("  no address-returning getters found");
  }
  // Selector scan
  const sels = await probeSelectors(addr);
  if (sels.length) {
    console.log("  responding deposit selectors:");
    for (const s of sels) console.log(`    ${s.label.padEnd(20)} ${s.sig.padEnd(50)} ${s.result}`);
  } else {
    console.log("  no deposit selector responded specifically");
  }
}

async function main() {
  for (const [n, a] of VAULTS) await inspect(n, a);
}
main().catch(e => { console.error(e); process.exit(1); });
