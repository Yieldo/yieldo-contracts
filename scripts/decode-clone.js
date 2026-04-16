const { ethers } = require("hardhat");

async function main() {
  const provider = new ethers.JsonRpcProvider("https://rpc.monad.xyz");
  const addrs = [
    "0xD0943c76ee287793559c1dF82E5B2B858Dd01Ef3", // Delta Neutral
    "0xCb9c1Fbf1b8Fcd71a70A1A6551dcaaF9f7029c19", // Yuzu
  ];

  for (const a of addrs) {
    const code = await provider.getCode(a);
    console.log(`\n${a}`);
    console.log(`  bytecode: ${code}`);
    console.log(`  length: ${(code.length - 2) / 2} bytes`);

    // Try standard EIP-1167 (45 bytes): 0x363d3d373d3d3d363d73<addr>5af43d82803e903d91602b57fd5bf3
    const m1167 = code.match(/^0x363d3d373d3d3d363d73([a-fA-F0-9]{40})5af43d82803e903d91602b57fd5bf3$/);
    if (m1167) { console.log(`  EIP-1167 impl: 0x${m1167[1]}`); continue; }

    // Try ERC-1967 Beacon/Proxy patterns — check storage slot
    // ERC-1967 impl slot: keccak256("eip1967.proxy.implementation") - 1
    const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
    const slot = await provider.getStorage(a, IMPL_SLOT);
    console.log(`  ERC-1967 impl slot: ${slot}`);
    if (slot !== "0x" + "0".repeat(64)) {
      const impl = "0x" + slot.slice(-40);
      const implCode = await provider.getCode(impl);
      console.log(`    impl addr: ${impl}`);
      console.log(`    impl code: ${(implCode.length - 2) / 2} bytes`);
    }

    // Beacon slot: keccak256("eip1967.proxy.beacon") - 1
    const BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
    const beacon = await provider.getStorage(a, BEACON_SLOT);
    console.log(`  ERC-1967 beacon slot: ${beacon}`);

    // Admin slot
    const ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
    const admin = await provider.getStorage(a, ADMIN_SLOT);
    console.log(`  ERC-1967 admin slot: ${admin}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
