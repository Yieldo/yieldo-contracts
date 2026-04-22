const hre = require("hardhat");
async function main() {
  const provider = hre.ethers.provider;
  const txHash = process.env.TX;
  if (!txHash) throw new Error("Set TX=<hash>");
  const rcpt = await provider.getTransactionReceipt(txHash);
  const tx = await provider.getTransaction(txHash);
  console.log("network:", hre.network.name);
  console.log("tx:", txHash);
  console.log("to:", tx.to);
  console.log("value:", tx.value.toString());
  console.log("status:", rcpt.status);
  console.log("gasUsed:", rcpt.gasUsed.toString());
  console.log("logs:", rcpt.logs.length);
  for (const log of rcpt.logs.slice(0, 15)) {
    console.log("  addr:", log.address, "topic0:", log.topics[0].slice(0, 10));
  }
  // try simulate to get revert reason
  try {
    await provider.call({ to: tx.to, data: tx.data, value: tx.value, from: tx.from }, rcpt.blockNumber);
  } catch (e) {
    console.log("sim err:", e.shortMessage || e.message);
  }
}
main().catch(e => console.error(e.message || e));
