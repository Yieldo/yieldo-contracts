// Wire Hyperbeat USDT (hbUSDT) Midas IV on HyperEVM router.
// Per Hyperbeat docs:
//   shareToken (hbUSDT)        = 0x5e105266db42f78FA814322Bce7f388B4C2e61eb
//   Insurance Contract (IV)     = 0xbE8A4f1a312b94A712F8E5367B02ae6E378E6F19
//   Accepted: USDT0, USDe, USR
//   depositInstant(tokenIn, amount18, minReceive, referrerId) — same as mainnet Midas
//
// One tx: router.setMidasVault(shareToken, iv). Costs ~$0.001 on HyperEVM.
const hre = require("hardhat");
const { ethers } = hre;

const ROUTER  = "0xa682CD1c2Fd7c8545b401824096A600C2bD98F69"; // HyperEVM DepositRouter
const SHARE   = "0x5e105266db42f78FA814322Bce7f388B4C2e61eb"; // hbUSDT
const IV      = "0xbE8A4f1a312b94A712F8E5367B02ae6E378E6F19"; // Insurance Contract

const ROUTER_ABI = [
  "function owner() view returns (address)",
  "function midasVaults(address) view returns (address)",
  "function setMidasVault(address token, address iv)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("deployer:", signer.address);
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, signer);
  const owner = await router.owner();
  console.log("router owner:", owner);
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Signer ${signer.address} is not router owner ${owner}`);
  }
  const before = await router.midasVaults(SHARE);
  console.log("current midasVaults(hbUSDT):", before);
  if (before.toLowerCase() === IV.toLowerCase()) { console.log("already wired"); return; }
  console.log("\nsetMidasVault(hbUSDT, IV)...");
  const tx = await router.setMidasVault(SHARE, IV);
  console.log("  tx:", tx.hash);
  await tx.wait();
  const after = await router.midasVaults(SHARE);
  console.log("  ✓ midasVaults(hbUSDT) =", after);
}
main().catch(e => { console.error(e); process.exit(1); });
