// Probe what interface 9Summits Flagship ETH (Lagoon vault) exposes:
// sync ERC4626 deposit(), or async ERC7540 requestDeposit(), or both.
require("dotenv").config();
const { JsonRpcProvider, Contract } = require("ethers");

const VAULT = "0x07ed467acD4ffd13023046968b0859781cb90D9B";
const provider = new JsonRpcProvider(process.env.ETHEREUM_RPC_URL, 1);

// Probe a bunch of selectors — call returns 0x for missing methods, real bytes for present ones.
const PROBES = [
  ["asset()(address)",                              null],
  ["totalAssets()(uint256)",                        null],
  ["totalSupply()(uint256)",                        null],
  ["name()(string)",                                null],
  ["symbol()(string)",                              null],
  // ERC-4626 sync
  ["maxDeposit(address)(uint256)",                  ["0x0000000000000000000000000000000000000001"]],
  ["previewDeposit(uint256)(uint256)",              [1000000000000000000n]],
  // ERC-7540 async
  ["pendingDepositRequest(uint256,address)(uint256)", [0n, "0x0000000000000000000000000000000000000001"]],
  ["claimableDepositRequest(uint256,address)(uint256)",[0n, "0x0000000000000000000000000000000000000001"]],
  // Lagoon-specific extras
  ["pendingSilo()(address)",                        null],
  ["safe()(address)",                               null],
  ["valuationManager()(address)",                   null],
  ["whitelistManager()(address)",                   null],
  ["isOpen()(bool)",                                null],
];

async function main() {
  for (const [sig, args] of PROBES) {
    try {
      const c = new Contract(VAULT, [`function ${sig} view`], provider);
      const fn = sig.split("(")[0];
      const res = args ? await c[fn](...args) : await c[fn]();
      console.log(`✓ ${sig.padEnd(60)} -> ${res}`);
    } catch (e) {
      const msg = (e.shortMessage || e.message || "").slice(0, 80);
      console.log(`✗ ${sig.padEnd(60)} -> ${msg}`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
