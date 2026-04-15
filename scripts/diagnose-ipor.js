/**
 * Check whether the DepositRouter is whitelisted on each IPOR Plasma Vault.
 * IPOR vaults apply a `restricted` modifier calling `_checkCanCall(msg.sender)` —
 * if router isn't whitelisted, deposit reverts with AccessManagedUnauthorizedAccount.
 *
 * Simulates deposit(1, router) from the router's address via eth_call. If it
 * reverts with the auth error, whitelist is required. If it gets past the auth
 * check (revert with "ERC20: insufficient allowance" or similar), we're cleared.
 */
const hre = require("hardhat");

const ROUTER_MAINNET = "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d";
const ROUTER_BASE = "0xF6B7723661d52E8533c77479d3cad534B4D147Aa";

const IPOR_VAULTS = [
  { chain: 1,    addr: "0xb8a451107a9f87fde481d4d686247d6e43ed715e", name: "IPOR stETH Ethereum" },
  { chain: 1,    addr: "0xe9385eff3f937fcb0f0085da9a3f53d6c2b4fb5f", name: "Reservoir wsrUSD Looping" },
  { chain: 1,    addr: "0x604117f0c94561231060f56cd2ddd16245d434c5", name: "AavEthena Loop Mainnet" },
  { chain: 1,    addr: "0xf6cd9e8415162c8fb3c52676c7ca68812a34f76e", name: "Reservoir ETH Yield" },
  { chain: 8453, addr: "0xc4c00d8b323f37527eeda27c87412378be9f68ec", name: "IPOR wstETH Base" },
  { chain: 1,    addr: "0xe47358eae04719f3cf7025e95d0ad202e68bd9b2", name: "Reservoir BTC Yield" },
];

const RPC = {
  1: process.env.ETHEREUM_RPC_URL || "https://ethereum-rpc.publicnode.com",
  8453: process.env.BASE_RPC_URL || "https://mainnet.base.org",
};

async function main() {
  const { ethers } = hre;
  const iface = new ethers.Interface([
    "function deposit(uint256,address) returns (uint256)",
    "function asset() view returns (address)",
    "function name() view returns (string)",
    "function authority() view returns (address)",
  ]);

  for (const v of IPOR_VAULTS) {
    const p = new ethers.JsonRpcProvider(RPC[v.chain]);
    const router = v.chain === 1 ? ROUTER_MAINNET : ROUTER_BASE;
    const c = new ethers.Contract(v.addr, iface, p);

    let asset, authority;
    try { asset = await c.asset(); } catch { asset = "(no fn)"; }
    try { authority = await c.authority(); } catch { authority = "(no fn)"; }

    // Static-call deposit(1, router) from router
    let result = "unknown";
    try {
      const data = iface.encodeFunctionData("deposit", [1n, router]);
      await p.call({ from: router, to: v.addr, data });
      result = "PASSED auth (reverted somewhere else or succeeded)";
    } catch (e) {
      const msg = e.shortMessage || e.reason || e.message || "";
      const rawData = e.data || "";
      if (/AccessManagedUnauthorized|unauthorized|not.*whitelist|AccessControl|restricted/i.test(msg) ||
          rawData.startsWith("0x068bcd8d") ||  // AccessManagedUnauthorizedAccount selector
          rawData.startsWith("0x7651f8c6")) {  // AccessControlUnauthorizedAccount selector
        result = "BLOCKED — router not whitelisted";
      } else if (/allowance|balance|transfer/i.test(msg)) {
        result = "OK — passed auth (would fail on approval/balance)";
      } else if (/0x/i.test(rawData) && rawData.length > 2) {
        result = `reverted with data: ${rawData.slice(0, 20)}...  (likely NOT whitelist)`;
      } else {
        result = "revert: " + msg.slice(0, 100);
      }
    }

    console.log(`\n${v.name}  [chain ${v.chain}]`);
    console.log(`  address:   ${v.addr}`);
    console.log(`  asset:     ${asset}`);
    console.log(`  authority: ${authority}`);
    console.log(`  result:    ${result}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
