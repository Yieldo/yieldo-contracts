const { ethers } = require("ethers");
require("dotenv").config();

const RPC = process.env.ETHEREUM_RPC_URL || "https://ethereum-rpc.publicnode.com";
const TX = "0xc114399ec740a5a66d89097a9c49201d978af0d57f462afb1a2342476ccae151";

async function main() {
  const p = new ethers.JsonRpcProvider(RPC);
  const tx = await p.getTransaction(TX);
  console.log("to:", tx.to);
  console.log("from:", tx.from);
  console.log("value:", tx.value.toString());
  console.log("data (first 10):", tx.data.slice(0, 10));

  // Try to replay at block-1 with the SAME gas limit to see if it's out-of-gas
  try {
    await p.call({ to: tx.to, from: tx.from, data: tx.data, value: tx.value, gas: tx.gasLimit }, tx.blockNumber - 1);
    console.log("replay with same gas: OK");
  } catch (e) {
    console.log("replay with same gas — error:", e.shortMessage || e.message);
  }

  // Now estimate gas needed
  try {
    const est = await p.estimateGas({ to: tx.to, from: tx.from, data: tx.data, value: tx.value }, tx.blockNumber - 1);
    console.log("estimateGas at block-1:", est.toString());
  } catch (e) {
    console.log("estimateGas error:", e.shortMessage || e.message);
  }
}
main().catch(console.error);
