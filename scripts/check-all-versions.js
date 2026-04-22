// Confirm VERSION = 3.1.0 + authorizedCallers set on all chains.
// Usage: npx hardhat run scripts/check-all-versions.js --network <name>
const hre = require("hardhat");

const PROXIES = {
  mainnet:  "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d",
  base:     "0xF6B7723661d52E8533c77479d3cad534B4D147Aa",
  arbitrum: "0xC5700f4D8054BA982C39838D7C33442f54688bd2",
  optimism: "0x7554937Aa95195D744A6c45E0fd7D4F95A2F8F72",
  monad:    "0xCD8dfD627A3712C9a2B079398e0d524970D5E73F",
  katana:   "0xa682CD1c2Fd7c8545b401824096A600C2bD98F69",
};

const LIFI = ["0x4DaC9d1769b9b304cb04741DCDEb2FC14aBdF110", "0x2dc0e2aa608532da689e89e237df582b783e5408", "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE"];

async function main() {
  const network = hre.network.name;
  const proxy = PROXIES[network];
  const provider = hre.ethers.provider;
  const res = await provider.call({ to: proxy, data: "0xffa1ad74" });
  const v = hre.ethers.AbiCoder.defaultAbiCoder().decode(["string"], res)[0];
  console.log(`${network}: VERSION = ${v}`);

  if (["mainnet", "base", "arbitrum", "optimism"].includes(network)) {
    const ABI = ["function authorizedCallers(address) view returns (bool)"];
    const c = new hre.ethers.Contract(proxy, ABI, provider);
    for (const a of LIFI) {
      const ok = await c.authorizedCallers(hre.ethers.getAddress(a));
      console.log(`  ${a} — ${ok ? "authorized" : "MISSING"}`);
    }
  }
}
main().catch(console.error);
