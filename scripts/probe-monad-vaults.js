const { ethers } = require("hardhat");

const RPC = "https://rpc.monad.xyz";
const ROUTER = "0xCD8dfD627A3712C9a2B079398e0d524970D5E73F";

const VAULTS = [
  { name: "Grove x Steakhouse AUSD",    addr: "0x32841A8511D5c2c5b253f45668780B99139e476D" },
  { name: "Hyperithm USDC Degen",       addr: "0xA8665084D8CD6276c00CA97Cbc0BF4BC9ae94c79" },
  { name: "Steakhouse Prime ETH",       addr: "0xba8424EBBEd6C51bEa6d6D903B8815838E6a0322" },
  { name: "Hyperithm Delta Neutral",    addr: "0xd0943c76EE287793559c1df82E5b2b858dD01Ef3" },
  { name: "Yuzu Money Vault",           addr: "0xcb9c1FBF1B8fCd71a70A1a6551DcaAf9f7029C19" },
];

const ABI = [
  "function asset() view returns (address)",
  "function name() view returns (string)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function maxDeposit(address) view returns (uint256)",
  "function previewDeposit(uint256) view returns (uint256)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);

  for (const v of VAULTS) {
    const addr = ethers.getAddress(v.addr.toLowerCase());
    console.log(`\n=== ${v.name} ===`);
    console.log(`  addr: ${addr}`);

    const code = await provider.getCode(addr);
    console.log(`  code: ${(code.length - 2) / 2} bytes`);

    if (code === "0x") { console.log("  >>> NO CONTRACT AT THIS ADDRESS"); continue; }

    const c = new ethers.Contract(addr, ABI, provider);
    const probe = async (label, fn) => {
      try { const r = await fn(); console.log(`  ${label}: ${r}`); return r; }
      catch (e) { console.log(`  ${label}: REVERT`); return null; }
    };

    await probe("asset", () => c.asset());
    await probe("name", () => c.name());
    await probe("totalAssets", () => c.totalAssets());
    const ts = await probe("totalSupply", () => c.totalSupply());
    await probe("maxDeposit(router)", () => c.maxDeposit(ROUTER));
    await probe("previewDeposit(1e6)", () => c.previewDeposit(1_000_000));

    try {
      const data = c.interface.encodeFunctionData("previewDeposit", [1_000_000]);
      await provider.call({ from: ROUTER, to: addr, data });
    } catch(e) {}

    // Real simulation: deposit
    try {
      const iface = new ethers.Interface(["function deposit(uint256,address) returns (uint256)"]);
      const data = iface.encodeFunctionData("deposit", [1_000_000, ROUTER]);
      await provider.call({ from: ROUTER, to: addr, data });
      console.log(`  simulated deposit(1e6): OK ${ts === null ? "(but reads revert -> fake OK)" : ""}`);
    } catch (e) {
      console.log(`  simulated deposit(1e6): REVERT`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
