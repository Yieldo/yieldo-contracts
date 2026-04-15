/**
 * Mainnet V2.6: deploy escrow + impl, upgrade proxy (with reinitializeV4 since
 * mainnet is at V2.5.1), set escrow impl. Uses manual nonces + low priority fee.
 */
require("dotenv").config();
const { ethers } = require("ethers");

const PROXY = "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d";

async function main() {
  const hre = require("hardhat");
  const rpc = process.env.ETHEREUM_RPC_URL || "https://ethereum-rpc.publicnode.com";
  const p = new ethers.JsonRpcProvider(rpc);
  const w = new ethers.Wallet(process.env.PRIVATE_KEY, p);

  const bal = await p.getBalance(w.address);
  console.log("Deployer:", w.address, "| balance:", ethers.formatEther(bal), "ETH");

  const feeData = await p.getFeeData();
  const baseFee = feeData.gasPrice - (feeData.maxPriorityFeePerGas || 0n);
  const priority = ethers.parseUnits("0.05", "gwei");
  const maxFee = (baseFee * 13n) / 10n + priority;
  console.log(`Gas: base ${ethers.formatUnits(baseFee, "gwei")} gwei | priority 0.05 | maxFee ${ethers.formatUnits(maxFee, "gwei")} gwei\n`);

  let nonce = await p.getTransactionCount(w.address, "latest");

  // === 1. Deploy WithdrawalEscrow ===
  const escrowArtifact = await hre.artifacts.readArtifact("WithdrawalEscrow");
  const escrowFactory = new ethers.ContractFactory(escrowArtifact.abi, escrowArtifact.bytecode, w);
  console.log("1. Deploying WithdrawalEscrow (nonce " + nonce + ")...");
  const escrow = await escrowFactory.deploy({ nonce: nonce++, maxPriorityFeePerGas: priority, maxFeePerGas: maxFee });
  await escrow.deploymentTransaction().wait();
  const escrowAddr = await escrow.getAddress();
  console.log("   escrow:", escrowAddr);

  // === 2. Deploy DepositRouter impl ===
  const routerArtifact = await hre.artifacts.readArtifact("DepositRouter");
  const routerFactory = new ethers.ContractFactory(routerArtifact.abi, routerArtifact.bytecode, w);
  console.log("\n2. Deploying DepositRouter V2.6 impl (nonce " + nonce + ")...");
  const impl = await routerFactory.deploy({ nonce: nonce++, maxPriorityFeePerGas: priority, maxFeePerGas: maxFee });
  await impl.deploymentTransaction().wait();
  const implAddr = await impl.getAddress();
  console.log("   impl:", implAddr);

  // === 3. Upgrade proxy with reinitializeV4 ===
  const routerIface = new ethers.Interface(routerArtifact.abi);
  const initData = routerIface.encodeFunctionData("reinitializeV4", []);
  const router = new ethers.Contract(PROXY, routerArtifact.abi, w);
  console.log("\n3. upgradeToAndCall + reinitializeV4 (nonce " + nonce + ")...");
  const tx1 = await router.upgradeToAndCall(implAddr, initData, {
    nonce: nonce++, maxPriorityFeePerGas: priority, maxFeePerGas: maxFee, gasLimit: 250000,
  });
  console.log("   tx:", tx1.hash);
  await tx1.wait();
  console.log("   VERSION:", await router.VERSION());

  // === 4. setWithdrawEscrowImpl ===
  console.log("\n4. setWithdrawEscrowImpl (nonce " + nonce + ")...");
  const tx2 = await router.setWithdrawEscrowImpl(escrowAddr, {
    nonce: nonce++, maxPriorityFeePerGas: priority, maxFeePerGas: maxFee, gasLimit: 100000,
  });
  console.log("   tx:", tx2.hash);
  await tx2.wait();

  // Verify
  console.log("\n=== Mainnet V2.6 operational ===");
  console.log("VERSION:            ", await router.VERSION());
  console.log("owner:              ", await router.owner());
  console.log("signer:             ", await router.signer());
  console.log("referralSplitBps:   ", (await router.referralSplitBps()).toString());
  console.log("withdrawEscrowImpl: ", await router.withdrawEscrowImpl());
  console.log("Proxy:", PROXY);
  console.log("Impl: ", implAddr);
  console.log("Escrow:", escrowAddr);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
