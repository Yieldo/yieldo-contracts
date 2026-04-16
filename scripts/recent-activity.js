const { ethers } = require("hardhat");

async function main() {
  const provider = new ethers.JsonRpcProvider("https://rpc.monad.xyz");
  const proxy = "0xD0943c76ee287793559c1dF82E5B2B858Dd01Ef3";
  const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
  const latest = await provider.getBlockNumber();

  // Pull 100-block windows to work around RPC limit
  async function getLogs(address, topics, fromBlock, toBlock) {
    const all = [];
    for (let b = fromBlock; b <= toBlock; b += 99) {
      const to = Math.min(b + 98, toBlock);
      try {
        const logs = await provider.getLogs({ address, topics, fromBlock: b, toBlock: to });
        all.push(...logs);
      } catch(e) {}
    }
    return all;
  }

  console.log(`=== Events emitted BY Hyperithm Delta Neutral in last 500 blocks ===`);
  const outLogs = await getLogs(proxy, undefined, latest - 500, latest);
  console.log(`  count: ${outLogs.length}`);
  for (const l of outLogs.slice(0, 5)) {
    console.log(`    block=${l.blockNumber} tx=${l.transactionHash} topic0=${l.topics[0]}`);
  }

  console.log(`\n=== USDC Transfers TO Hyperithm Delta Neutral in last 500 blocks ===`);
  const inLogs = await getLogs(USDC, [
    ethers.id("Transfer(address,address,uint256)"), null, ethers.zeroPadValue(proxy, 32)
  ], latest - 500, latest);
  console.log(`  count: ${inLogs.length}`);
  for (const l of inLogs.slice(0, 3)) {
    console.log(`    block=${l.blockNumber} tx=${l.transactionHash}`);
  }

  // Find the deployment / most-recent tx by scanning
  console.log(`\n=== Checking last transaction in which proxy appeared ===`);
  // Pull tx from a specific block where the deployment happened (we'll guess by finding first event)
  // Just verify if the vault has ANY code via ERC-1967 admin
  const impl = "0x59b0b84371bb3261fad538c512efffc414cc1725";
  console.log(`  proxy code hash: ${ethers.keccak256(await provider.getCode(proxy))}`);
  console.log(`  impl  code hash: ${ethers.keccak256(await provider.getCode(impl))}`);

  // Look for deployment block and initial config of impl
  // Check impl's own recent events (MetaMorpho emits things)
  console.log(`\n=== Checking impl events (last 300 blocks) ===`);
  const implLogs = await getLogs(impl, undefined, latest - 300, latest);
  console.log(`  count: ${implLogs.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
