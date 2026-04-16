/**
 * Configure Lido Earn SyncDepositQueues on the router (mainnet only).
 * Run AFTER V2.6.2 mainnet upgrade + `setVaultAllowed` (if whitelist is on).
 *
 *   npx hardhat run scripts/configure-lido-queues.js --network mainnet
 */
const hre = require("hardhat");

const ROUTER = "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d";

const EARN_USD = "0x014e6DA8F283C4aF65B2AA0f201438680A004452";
const EARN_ETH = "0x6a37725ca7f4CE81c004c955f7280d5C704a249e";

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const WSTETH = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0";

// SyncDepositQueues — per (vault, asset). Sourced from
// https://docs.lido.fi/earn/deployment-contracts.
const QUEUES = [
  { vault: EARN_USD, asset: USDC, queue: "0xf6AFAf6afcAe116dD37A779D50fE6c5fa6f8C8f5", label: "earnUSD / USDC" },
  { vault: EARN_USD, asset: USDT, queue: "0x534d0bEb82C47cf703BFb9E959297658b65Ec8E9", label: "earnUSD / USDT" },
  { vault: EARN_ETH, asset: WETH, queue: "0xCe6C2505fEF74d2dE10FCF1d534cB73eCc837976", label: "earnETH / WETH" },
  { vault: EARN_ETH, asset: WSTETH, queue: "0xECD2Bfe725fa14f5Ed86e9bDcc0eA4b34A4ed522", label: "earnETH / wstETH" },
];

async function main() {
  const router = await hre.ethers.getContractAt("DepositRouter", ROUTER);
  const version = await router.VERSION();
  console.log("Router version:", version);

  const vaults = QUEUES.map(q => q.vault);
  const assets = QUEUES.map(q => q.asset);
  const queues = QUEUES.map(q => q.queue);

  console.log("\nCalling setLidoDepositQueueBatch...");
  const tx = await router.setLidoDepositQueueBatch(vaults, assets, queues);
  console.log("tx:", tx.hash);
  await tx.wait();

  console.log("\nVerification:");
  for (const q of QUEUES) {
    const stored = await router.lidoDepositQueues(q.vault, q.asset);
    console.log(`  ${q.label}: ${stored.toLowerCase() === q.queue.toLowerCase() ? "OK" : "MISMATCH"}  (${stored})`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
