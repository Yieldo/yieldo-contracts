const hre = require("hardhat");
const PROXIES = {
  mainnet:     "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d",
  base:        "0xF6B7723661d52E8533c77479d3cad534B4D147Aa",
  arbitrum:    "0xC5700f4D8054BA982C39838D7C33442f54688bd2",
  optimism:    "0x7554937Aa95195D744A6c45E0fd7D4F95A2F8F72",
  monad:       "0xCD8dfD627A3712C9a2B079398e0d524970D5E73F",
  hyperliquid: "0xa682CD1c2Fd7c8545b401824096A600C2bD98F69",
};
async function main() {
  const proxy = PROXIES[hre.network.name];
  const ABI = ["function VERSION() view returns (string)", "function owner() view returns (address)", "function pendingOwner() view returns (address)"];
  const c = new hre.ethers.Contract(proxy, ABI, hre.ethers.provider);
  console.log(`${hre.network.name.padEnd(12)} V=${await c.VERSION()} owner=${await c.owner()} pending=${await c.pendingOwner()}`);
}
main().catch(e => { console.error(e); process.exit(1); });
