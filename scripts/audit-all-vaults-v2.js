// Comprehensive vault audit — catches every class of bug we've hit:
//   1. Asset mismatch    — backend's asset_address != vault.asset() on-chain
//   2. Broken wiring     — share_token configured but router adapter not wired
//                            (Lido queue not set, Upshift adapter not wired, etc.)
//   3. Paused vaults     — vault rejects every direct deposit at the contract level
//   4. Multi-contract gap — vault is multi-contract architecture (orchestrator +
//                            share token) but our config has no share_token field
require("dotenv").config();
const { JsonRpcProvider, Contract } = require("ethers");

const ROUTERS = {
  1:    "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d",
  8453: "0xF6B7723661d52E8533c77479d3cad534B4D147Aa",
  42161:"0xC5700f4D8054BA982C39838D7C33442f54688bd2",
  10:   "0x7554937Aa95195D744A6c45E0fd7D4F95A2F8F72",
  143:  "0xCD8dfD627A3712C9a2B079398e0d524970D5E73F",
};

const RPCS = {
  1:    process.env.ETHEREUM_RPC_URL,
  8453: process.env.BASE_RPC_URL || "https://mainnet.base.org",
  42161:process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
  10:   process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io",
  143:  process.env.MONAD_RPC_URL || "https://rpc.monad.xyz",
  999:  process.env.HYPEREVM_RPC_URL || "https://rpc.hyperliquid.xyz/evm",
};

const ROUTER_ABI = [
  "function vaultAdapters(address) view returns (address)",
  "function midasVaults(address) view returns (address)",
  "function lidoDepositQueues(address,address) view returns (address)",
  "function vedaTellers(address) view returns (address)",
];

const PAUSED_SELECTOR = "0xdeeb6943";
const TEST_USER = "0x0000000000000000000000000000000000000001";
const ZERO = "0x0000000000000000000000000000000000000000";

function pad32(addr) { return "000000000000000000000000" + addr.slice(2).toLowerCase(); }

// Selectors that mean "your test address lacks balance/allowance" — NOT a bug
// in the vault. The vault's deposit selector exists and the function entered
// the transferFrom step, just rejected because we have no tokens. With a real
// user holding the asset + approval, this would succeed.
const FUNDING_REVERTS = new Set([
  "0x1425ea42", // FailedInnerCall() — wraps ERC20 transferFrom failure
  "0xfb8f41b2", // ERC20InsufficientAllowance(address,uint256,uint256)
  "0x13be252b", // InsufficientAllowance()
  "0xe65b7a77", // TransferFromReverted()
  "0x4e487b71", // Panic(uint256) — usually arithmetic with 0 balance
  "0x5945ea56", // InsufficientAmount() — share-rounding, would work with real amount
]);
// Strings within `Error(string)` 0x08c379a0 reverts that mean lack-of-funds
const FUNDING_STRINGS = ["allowance", "balance", "InsufficientAllowance", "ERC20: transfer"];

async function probeDeposit(provider, target, amount) {
  const data = "0x6e553f65" + amount.toString(16).padStart(64, "0") + pad32(TEST_USER);
  try {
    await provider.call({ from: TEST_USER, to: target, data });
    return { ok: true, msg: "would succeed (no balance/allowance gating)" };
  } catch (e) {
    const d = e.data || e.info?.error?.data || "";
    const sm = e.shortMessage || "";
    if (sm.includes("transfer amount exceeds")) return { ok: true, msg: "callable (allowance/balance error — expected)" };
    if (FUNDING_REVERTS.has(d.slice(0, 10))) return { ok: true, msg: `callable (${d.slice(0,10)} = funding error)` };
    // Decode Error(string) for finer detection
    if (d.startsWith("0x08c379a0")) {
      try {
        const { AbiCoder } = require("ethers");
        const [reason] = AbiCoder.defaultAbiCoder().decode(["string"], "0x" + d.slice(10));
        if (FUNDING_STRINGS.some(s => reason.includes(s))) return { ok: true, msg: `callable (string: "${reason.slice(0,40)}…")` };
        if (reason.toLowerCase().includes("paus")) return { ok: false, msg: `"${reason}" — paused` };
        return { ok: false, msg: `Error("${reason.slice(0,60)}")` };
      } catch {}
    }
    if (d.startsWith(PAUSED_SELECTOR)) return { ok: false, msg: "DepositsPaused()" };
    if (sm.includes("Deposits paused")) return { ok: false, msg: '"Deposits paused" string' };
    if (!d || d === "0x") return { ok: false, msg: "empty revert / require(false)" };
    return { ok: false, msg: `revert ${d.slice(0,10)} (unknown)` };
  }
}

async function checkVaultAsset(provider, vault) {
  try {
    const c = new Contract(vault, ["function asset() view returns (address)"], provider);
    return (await c.asset()).toLowerCase();
  } catch { return null; }
}

async function auditChain(chainId, vaults) {
  console.log(`\n========== CHAIN ${chainId} (${vaults.length} active vaults) ==========`);
  if (!RPCS[chainId]) { console.log("  no RPC configured, skipping"); return { ok: 0, warn: 0, fail: 0 }; }
  const provider = new JsonRpcProvider(RPCS[chainId], chainId);
  const router = ROUTERS[chainId] ? new Contract(ROUTERS[chainId], ROUTER_ABI, provider) : null;

  let ok = 0, warn = 0, fail = 0;
  for (const v of vaults) {
    const apiAsset = (v.asset?.address || "").toLowerCase();
    const vaultAddr = v.address;
    const type = v.type || "morpho";
    const flags = [];

    // 1. Asset match check
    const onchainAsset = await checkVaultAsset(provider, vaultAddr);
    if (onchainAsset && onchainAsset !== apiAsset) {
      flags.push(`ASSET MISMATCH: api=${apiAsset.slice(0,10)}…  chain=${onchainAsset.slice(0,10)}…`);
    } else if (!onchainAsset && !v.share_token) {
      flags.push("vault.asset() unreadable + no share_token configured (likely multi-contract)");
    }

    // 2. Router wiring check
    if (router) {
      if (type === "upshift") {
        const adapter = await router.vaultAdapters(v.share_token || vaultAddr).catch(() => ZERO);
        if (!adapter || adapter === ZERO) flags.push("no UpshiftAdapter wired on router");
      } else if (type === "lido") {
        const queue = await router.lidoDepositQueues(v.share_token || vaultAddr, apiAsset).catch(() => ZERO);
        if (!queue || queue === ZERO) flags.push("no Lido queue wired on router");
      } else if (type === "midas") {
        const iv = await router.midasVaults(vaultAddr).catch(() => ZERO);
        if (!iv || iv === ZERO) flags.push("no Midas IV wired on router");
      } else if (type === "veda") {
        const teller = await router.vedaTellers(vaultAddr).catch(() => ZERO);
        if (!teller || teller === ZERO) flags.push("no Veda teller wired on router");
      }
    }

    // 3. Live deposit simulation for ERC4626-style vaults
    if (type === "morpho" || type === "ipor" || type === "accountable" || type === "upshift") {
      const dec = v.asset?.decimals || 18;
      const amount = BigInt(10) ** BigInt(Math.min(dec, 6));
      const target = (type === "upshift") ? (v.share_token || vaultAddr) : vaultAddr;
      const r = await probeDeposit(provider, target, amount);
      if (!r.ok) flags.push(r.msg);
    }

    if (v.paused) flags.push(`marked paused on UI ("${(v.paused_reason || "").slice(0, 40)}…")`);

    if (flags.length === 0) {
      console.log(`  OK    ${v.name.padEnd(36)} type=${type}`);
      ok++;
    } else {
      const broken = flags.some(f => f.startsWith("ASSET MISMATCH") || f.startsWith("no ") || f.startsWith("Deposits") || f.startsWith("empty") || f.startsWith("revert ") || f.startsWith("DepositsPaused"));
      const tag = broken ? "FAIL" : "WARN";
      console.log(`  ${tag}  ${v.name.padEnd(36)} type=${type}`);
      for (const f of flags) console.log(`        - ${f}`);
      if (broken) fail++; else warn++;
    }
  }
  console.log(`  → ${ok} OK, ${warn} WARN, ${fail} FAIL`);
  return { ok, warn, fail };
}

async function main() {
  const res = await fetch("https://api.yieldo.xyz/v1/vaults");
  const vaults = await res.json();
  const byChain = {};
  for (const v of vaults) {
    if (v.unsupported) continue;
    if (!byChain[v.chain_id]) byChain[v.chain_id] = [];
    byChain[v.chain_id].push(v);
  }
  let total = { ok: 0, warn: 0, fail: 0 };
  for (const c of Object.keys(byChain).map(Number).sort((a,b)=>a-b)) {
    const r = await auditChain(c, byChain[c]);
    total.ok += r.ok; total.warn += r.warn; total.fail += r.fail;
  }
  console.log(`\n=========================================================`);
  console.log(`TOTAL: ${total.ok} OK, ${total.warn} WARN, ${total.fail} FAIL across ${total.ok + total.warn + total.fail} vaults`);
}
main().catch(e => { console.error(e); process.exit(1); });
