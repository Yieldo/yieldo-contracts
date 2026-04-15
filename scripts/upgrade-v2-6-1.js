/**
 * V2.6.1 upgrade: strip withdraw logic from the live impl. Storage-compatible.
 * Works for Base, mainnet, Monad.
 */
require("dotenv").config();
const { ethers } = require("ethers");

const PROXIES = {
  mainnet: "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d",
  base: "0xF6B7723661d52E8533c77479d3cad534B4D147Aa",
  monad: "0xCD8dfD627A3712C9a2B079398e0d524970D5E73F",
};

async function main() {
  const hre = require("hardhat");
  const net = hre.network.name;
  const proxyAddr = PROXIES[net];
  if (!proxyAddr) throw new Error(`Unknown network ${net}`);

  const p = hre.ethers.provider;
  const [deployer] = await hre.ethers.getSigners();
  console.log(`== V2.6.1 upgrade on ${net} ==`);
  console.log("Deployer:", deployer.address);

  const fees = await p.getFeeData();
  const baseFee = fees.gasPrice - (fees.maxPriorityFeePerGas || 0n);
  // Monad gas is higher per-gwei but MON is cheap; 1 gwei priority is fine there.
  const priorityGwei = net === "monad" ? "1" : "0.05";
  const priority = ethers.parseUnits(priorityGwei, "gwei");
  const maxFee = (baseFee * 13n) / 10n + priority;
  const gasOverrides = net === "monad"
    ? { gasPrice: fees.gasPrice + priority }
    : { maxPriorityFeePerGas: priority, maxFeePerGas: maxFee };
  console.log(`Gas: base ${ethers.formatUnits(baseFee, "gwei")} gwei | priority ${priorityGwei} gwei\n`);

  let nonce = await p.getTransactionCount(deployer.address, "latest");

  // Deploy new impl
  const Router = await hre.ethers.getContractFactory("DepositRouter");
  console.log("1. Deploying V2.6.1 impl (nonce " + nonce + ")...");
  const impl = await Router.deploy({ ...gasOverrides, nonce: nonce++ });
  await impl.deploymentTransaction().wait();
  const implAddr = await impl.getAddress();
  console.log("   impl:", implAddr);

  // Upgrade proxy (no reinit needed — storage is identical)
  const router = await hre.ethers.getContractAt("DepositRouter", proxyAddr);
  console.log("\n2. upgradeToAndCall(impl, 0x) (nonce " + nonce + ")...");
  const tx = await router.upgradeToAndCall(implAddr, "0x", { ...gasOverrides, nonce: nonce++, gasLimit: 200000 });
  console.log("   tx:", tx.hash);
  await tx.wait();

  console.log("\n=== Verify ===");
  console.log("VERSION:          ", await router.VERSION());
  console.log("owner:            ", await router.owner());
  console.log("signer:           ", await router.signer());
  console.log("referralSplitBps: ", (await router.referralSplitBps()).toString());
  console.log("proxy:", proxyAddr);
  console.log("impl: ", implAddr);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
