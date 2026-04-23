const hre = require("hardhat");
async function main() {
  const tx = process.env.TX;
  const provider = hre.ethers.provider;
  const rcpt = await provider.getTransactionReceipt(tx);
  console.log("Logs (decoded ERC-20 + LiFi):");
  for (const log of rcpt.logs) {
    const t = log.topics[0];
    if (t === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef") {
      // Transfer(from, to, value)
      const from = "0x" + log.topics[1].slice(26);
      const to = "0x" + log.topics[2].slice(26);
      const val = BigInt(log.data);
      console.log(`  Transfer ${log.address}: ${from} → ${to} amount=${val}`);
    } else if (t === "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925") {
      const owner = "0x" + log.topics[1].slice(26);
      const spender = "0x" + log.topics[2].slice(26);
      const val = BigInt(log.data);
      console.log(`  Approval ${log.address}: ${owner} approves ${spender} amount=${val}`);
    } else if (t === "0x1fbfa988ec3c4193ca2c66f56248bedf8a99fd384b3979ad7e54e29be41cd1e1") {
      console.log(`  LiFiTransferRecovered ${log.address}: data=${log.data}`);
    } else {
      console.log(`  ${log.address} topic0=${t.slice(0,10)} data=${log.data.slice(0, 200)}`);
    }
  }
}
main().catch(console.error);
