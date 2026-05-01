// Generate Safe Transaction Builder JSON files for each chain. Signers can
// import these into Safe Web UI to queue acceptOwnership() with one click.
const fs = require("fs");
const path = require("path");

const SAFE = "0x25DDB6a1a32986E097dCEF257d9006d9583d6232";

const CHAINS = {
  mainnet:     { id: "1",      proxy: "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d" },
  base:        { id: "8453",   proxy: "0xF6B7723661d52E8533c77479d3cad534B4D147Aa" },
  arbitrum:    { id: "42161",  proxy: "0xC5700f4D8054BA982C39838D7C33442f54688bd2" },
  optimism:    { id: "10",     proxy: "0x7554937Aa95195D744A6c45E0fd7D4F95A2F8F72" },
  monad:       { id: "143",    proxy: "0xCD8dfD627A3712C9a2B079398e0d524970D5E73F" },
  hyperliquid: { id: "999",    proxy: "0xa682CD1c2Fd7c8545b401824096A600C2bD98F69" },
  katana:      { id: "747474", proxy: "0xa682CD1c2Fd7c8545b401824096A600C2bD98F69" },
};

const ACCEPT_ABI = {
  inputs: [],
  name: "acceptOwnership",
  payable: false,
};

const outDir = path.join(__dirname, "..", "safe-txs");
fs.mkdirSync(outDir, { recursive: true });

for (const [name, { id, proxy }] of Object.entries(CHAINS)) {
  const json = {
    version: "1.0",
    chainId: id,
    createdAt: Date.now(),
    meta: {
      name: `Yieldo V3.3.0 acceptOwnership (${name})`,
      description: `Claim router proxy ownership from deployer EOA. Final step of audit-fix upgrade. After execution, owner=${SAFE}.`,
      txBuilderVersion: "1.16.5",
      createdFromSafeAddress: SAFE,
      createdFromOwnerAddress: "",
      checksum: "",
    },
    transactions: [
      {
        to: proxy,
        value: "0",
        data: null,
        contractMethod: ACCEPT_ABI,
        contractInputsValues: {},
      },
    ],
  };
  const file = path.join(outDir, `${name}-acceptOwnership.json`);
  fs.writeFileSync(file, JSON.stringify(json, null, 2));
  console.log(`  ✓ ${name.padEnd(12)} → ${path.relative(process.cwd(), file)}`);
}

console.log("\nDone. Workflow:");
console.log("  1. Open https://app.safe.global, switch to the chain");
console.log("  2. Apps → Transaction Builder → Load → drag in the JSON");
console.log("  3. Submit batch → 2 of 3 signers confirm → Execute");
console.log("  4. After exec, owner() == Safe; pendingOwner() == 0x0\n");
