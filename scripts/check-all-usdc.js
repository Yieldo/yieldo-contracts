const hre = require("hardhat");
const USDC = {
  mainnet: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  optimism: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
};
async function main() {
  const [s] = await hre.ethers.getSigners();
  const n = hre.network.name;
  const c = new hre.ethers.Contract(USDC[n], ["function balanceOf(address) view returns (uint256)"], hre.ethers.provider);
  const bal = await c.balanceOf(s.address);
  const eth = await hre.ethers.provider.getBalance(s.address);
  console.log(`${n}: USDC=${(Number(bal)/1e6).toFixed(4)} ETH=${hre.ethers.formatEther(eth)}`);
}
main().catch(console.error);
