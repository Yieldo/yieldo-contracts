// Simulate the LiFi Executor calling our router's depositFor on Base.
// Pretends Executor has 1.5 USDC + has approved router. Tells us whether the router-side fails.
const hre = require("hardhat");
async function main() {
  const provider = hre.ethers.provider;
  const ROUTER  = "0xF6B7723661d52E8533c77479d3cad534B4D147Aa";
  const VAULT   = "0xbeefe94c8ad530842bfe7d8b397938ffc1cb83b2";
  const USDC    = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const USER    = "0x7E14104e2433fDe49C98008911298F069C9dE41a";
  const EXEC    = "0x4DaC9d1769b9b304cb04741DCDEb2FC14aBdF110"; // LiFi Executor on Base
  const AMOUNT  = 1492816n;

  // Build depositFor 7-arg calldata
  const iface = new hre.ethers.Interface([
    "function depositFor(address,address,uint256,address,bytes32,uint8,bool)"
  ]);
  const data = iface.encodeFunctionData("depositFor", [
    VAULT, USDC, AMOUNT, USER,
    "0x0000000000000000000000000000000000000000000000000000000000000000",
    0, true,
  ]);
  console.log("calldata:", data.slice(0, 30) + "...");
  console.log("amount:  ", AMOUNT.toString(), "(1.49 USDC)");

  // Check Executor's USDC balance + allowance to router
  const erc20 = new hre.ethers.Contract(USDC, [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
  ], provider);
  console.log("Executor USDC bal: ", (await erc20.balanceOf(EXEC)).toString());
  console.log("Executor→Router  : ", (await erc20.allowance(EXEC, ROUTER)).toString());

  // Try eth_call from EXEC
  console.log("\nSimulating depositFor from Executor...");
  try {
    await provider.call({ from: EXEC, to: ROUTER, data });
    console.log("→ OK");
  } catch (e) {
    console.log("→ REVERT:", e.shortMessage || e.message);
    if (e.data) console.log("  data:", e.data);
  }
}
main().catch(console.error);
