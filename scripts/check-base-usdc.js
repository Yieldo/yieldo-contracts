const hre = require("hardhat");
async function main() {
  const [s] = await hre.ethers.getSigners();
  const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const c = new hre.ethers.Contract(USDC, ["function balanceOf(address) view returns (uint256)"], hre.ethers.provider);
  const bal = await c.balanceOf(s.address);
  console.log("Base USDC:", (Number(bal) / 1e6).toFixed(4));
  const ethBal = await hre.ethers.provider.getBalance(s.address);
  console.log("Base ETH: ", hre.ethers.formatEther(ethBal));
}
main().catch(console.error);
