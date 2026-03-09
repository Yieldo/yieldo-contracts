const { ethers } = require("ethers");
const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");

const txHash = process.argv[2] || "0x209a05df8a62a72b181bb5efff6c2ac632ccbd664924a95d7942495234e1441b";

const labels = {
  "0xF6B7723661d52E8533c77479d3cad534B4D147Aa": "DepositRouter",
  "0x7E14104e2433fDe49C98008911298F069C9dE41a": "User",
  "0xBEb2986BD5b7ADDB360D0BbdAD9a7DE21854F427": "FEE_COLLECTOR",
  "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61": "Gauntlet Vault",
  "0xBEEFE94c8aD530842bfE7d8B397938fFc1cb83b2": "Steakhouse Vault",
};
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const label = (a) => labels[a] || a.slice(0, 12) + "...";

async function main() {
  const receipt = await provider.getTransactionReceipt(txHash);
  console.log("TX:", txHash);
  console.log("Status:", receipt.status === 1 ? "SUCCESS" : "REVERTED");

  const transferTopic = ethers.id("Transfer(address,address,uint256)");
  const depositExecTopic = ethers.id("DepositExecuted(bytes32,address,address,uint256,uint256)");

  let totalToRouter = 0n, fee = 0n, refunded = 0n, deposited = 0n;

  console.log("\nUSDC Transfers:");
  for (const log of receipt.logs) {
    if (log.topics[0] !== transferTopic || log.topics.length !== 3) continue;
    if (log.address.toLowerCase() !== USDC) continue;

    const from = ethers.getAddress("0x" + log.topics[1].slice(26));
    const to = ethers.getAddress("0x" + log.topics[2].slice(26));
    const amount = BigInt(log.data);
    const amountStr = (Number(amount) / 1e6).toFixed(6);

    console.log("  " + amountStr + " USDC: " + label(from) + " -> " + label(to));

    if (to === "0xF6B7723661d52E8533c77479d3cad534B4D147Aa") totalToRouter = amount;
    if (to === "0xBEb2986BD5b7ADDB360D0BbdAD9a7DE21854F427") fee = amount;
    if (to === "0x7E14104e2433fDe49C98008911298F069C9dE41a") refunded += amount;
  }

  for (const log of receipt.logs) {
    if (log.topics[0] !== depositExecTopic) continue;
    const iface = new ethers.Interface([
      "event DepositExecuted(bytes32 indexed intentHash, address indexed user, address indexed vault, uint256 amount, uint256 usdValue)",
    ]);
    const parsed = iface.parseLog({ topics: log.topics, data: log.data });
    deposited = parsed.args.amount;
    console.log("\nDepositExecuted:");
    console.log("  Deposited: " + (Number(deposited) / 1e6).toFixed(6) + " USDC");
    console.log("  USD Value: $" + Number(ethers.formatEther(parsed.args.usdValue)).toFixed(4));
  }

  console.log("\n--- Breakdown ---");
  console.log("Into Router:   " + (Number(totalToRouter) / 1e6).toFixed(6) + " USDC");
  console.log("Protocol Fee:  " + (Number(fee) / 1e6).toFixed(6) + " USDC");
  console.log("Deposited:     " + (Number(deposited) / 1e6).toFixed(6) + " USDC");
  console.log("Refunded:      " + (Number(refunded) / 1e6).toFixed(6) + " USDC");
  if (totalToRouter > 0n) {
    const eff = Number(deposited * 10000n / totalToRouter) / 100;
    console.log("Efficiency:    " + eff.toFixed(2) + "% of what reached router");
  }
}
main().catch(console.error);
