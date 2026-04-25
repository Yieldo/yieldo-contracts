// Deploy UpshiftAdapter to mainnet, then wire it to Upshift NUSD via
// router.setVaultAdapter. Total ~$1-2 of mainnet gas.
//
// Run:
//   cd E:/yieldo-contracts
//   npx hardhat run scripts/deploy-upshift-adapter.js --network mainnet
const hre = require("hardhat");
const { ethers } = hre;

const ROUTER = "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d"; // DepositRouter on Ethereum
const UPSHIFT_NUSD = "0xAEEb2fB279a5aA837367B9D2582F898a63b06ca1"; // first vault to wire

const ROUTER_ABI = [
  "function owner() view returns (address)",
  "function vaultAdapters(address) view returns (address)",
  "function setVaultAdapter(address vault, address adapter)",
];

// Cap mainnet gas tightly. Current base fee is ~0.2 gwei — these caps give
// headroom without risking overpayment. If base fee spikes during the tx, the
// tx pends until it falls back, costing nothing.
const MAX_FEE_GWEI = "0.5";
const MAX_PRIORITY_GWEI = "0.01";

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("deployer:", signer.address);
  const bal = await signer.provider.getBalance(signer.address);
  console.log("ETH balance:", ethers.formatEther(bal));

  // Verify current base fee is below our cap before sending — bail out if not.
  const fd = await signer.provider.getFeeData();
  const baseFee = (await signer.provider.getBlock("latest")).baseFeePerGas || 0n;
  console.log("current baseFee:", ethers.formatUnits(baseFee, "gwei"), "gwei");
  const maxFee = ethers.parseUnits(MAX_FEE_GWEI, "gwei");
  const maxPriority = ethers.parseUnits(MAX_PRIORITY_GWEI, "gwei");
  if (baseFee > maxFee) {
    throw new Error(`Base fee ${ethers.formatUnits(baseFee,"gwei")} gwei > our cap ${MAX_FEE_GWEI} gwei. Aborting.`);
  }
  console.log(`gas caps: maxFee=${MAX_FEE_GWEI} gwei, priority=${MAX_PRIORITY_GWEI} gwei`);
  const txOpts = { maxFeePerGas: maxFee, maxPriorityFeePerGas: maxPriority };

  // Sanity: signer must be router owner
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, signer);
  const owner = await router.owner();
  console.log("router owner:", owner);
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Signer ${signer.address} is not router owner ${owner}. Aborting.`);
  }

  // 1. Deploy UpshiftAdapter
  console.log("\n[1/3] Deploying UpshiftAdapter...");
  const Adapter = await ethers.getContractFactory("UpshiftAdapter");
  const adapter = await Adapter.deploy(txOpts);
  await adapter.waitForDeployment();
  const adapterAddr = await adapter.getAddress();
  console.log("  UpshiftAdapter:", adapterAddr);
  console.log("  deploy tx:", adapter.deploymentTransaction().hash);

  // 2. Wire to NUSD
  console.log("\n[2/3] Setting adapter for Upshift NUSD on router...");
  const tx = await router.setVaultAdapter(UPSHIFT_NUSD, adapterAddr, txOpts);
  console.log("  setVaultAdapter tx:", tx.hash);
  const r = await tx.wait();
  console.log("  ✓ confirmed in block", r.blockNumber);

  // 3. Verify
  const linked = await router.vaultAdapters(UPSHIFT_NUSD);
  console.log("\n[3/3] Verification:");
  console.log("  router.vaultAdapters(NUSD) =", linked);
  if (linked.toLowerCase() !== adapterAddr.toLowerCase()) {
    throw new Error("Adapter not wired correctly!");
  }

  const after = await signer.provider.getBalance(signer.address);
  console.log("\nGas spent:", ethers.formatEther(bal - after), "ETH");
  console.log("\nDONE. Now test a deposit through the router to NUSD.");
}

main().catch(e => { console.error(e); process.exit(1); });
