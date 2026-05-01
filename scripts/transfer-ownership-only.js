// Transfer ownership of the router proxy to the Safe (no impl change).
// Use when the impl upgrade already happened but ownership handoff didn't.
// Usage: npx hardhat run scripts/transfer-ownership-only.js --network <name>

const hre = require("hardhat");

const SAFE = "0x25DDB6a1a32986E097dCEF257d9006d9583d6232";

const PROXIES = {
  mainnet:     "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d",
  base:        "0xF6B7723661d52E8533c77479d3cad534B4D147Aa",
  arbitrum:    "0xC5700f4D8054BA982C39838D7C33442f54688bd2",
  optimism:    "0x7554937Aa95195D744A6c45E0fd7D4F95A2F8F72",
  monad:       "0xCD8dfD627A3712C9a2B079398e0d524970D5E73F",
  hyperliquid: "0xa682CD1c2Fd7c8545b401824096A600C2bD98F69",
};

const ABI = [
  "function transferOwnership(address newOwner)",
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function VERSION() view returns (string)",
];

async function main() {
  const network = hre.network.name;
  const proxy = PROXIES[network];
  if (!proxy) throw new Error(`No proxy for '${network}'`);

  const [deployer] = await hre.ethers.getSigners();
  const c = new hre.ethers.Contract(proxy, ABI, deployer);

  const ver = await c.VERSION();
  const owner = await c.owner();
  const pending = await c.pendingOwner();

  console.log(`\n=== ${network} ${proxy} ===`);
  console.log(`VERSION:      ${ver}`);
  console.log(`owner:        ${owner}`);
  console.log(`pendingOwner: ${pending}`);

  if (owner.toLowerCase() === SAFE.toLowerCase()) {
    console.log("Already owned by Safe. Done.");
    return;
  }
  if (pending.toLowerCase() === SAFE.toLowerCase()) {
    console.log("Safe is already pendingOwner. Awaiting acceptOwnership() from Safe.");
    return;
  }
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(`owner is ${owner}, can't transfer from ${deployer.address}`);
  }

  console.log("\ntransferOwnership(SAFE)...");
  const tx = await c.transferOwnership(SAFE);
  console.log("tx:", tx.hash);
  await tx.wait();
  console.log("pendingOwner now:", await c.pendingOwner());
}

main().catch(e => { console.error("\n❌", e.message || e); process.exit(1); });
