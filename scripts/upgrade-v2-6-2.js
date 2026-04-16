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
  console.log(`V2.6.2 upgrade on ${net} | proxy ${proxyAddr}`);

  const fees = await p.getFeeData();
  const baseFee = fees.gasPrice - (fees.maxPriorityFeePerGas || 0n);
  const priorityGwei = net === "monad" ? "1" : "0.05";
  const priority = ethers.parseUnits(priorityGwei, "gwei");
  const maxFee = (baseFee * 13n) / 10n + priority;
  const gas = net === "monad"
    ? { gasPrice: fees.gasPrice + priority }
    : { maxPriorityFeePerGas: priority, maxFeePerGas: maxFee };

  let nonce = await p.getTransactionCount(deployer.address, "latest");
  const Factory = await hre.ethers.getContractFactory("DepositRouter");
  console.log("1. Deploy impl (nonce " + nonce + ")...");
  const impl = await Factory.deploy({ ...gas, nonce: nonce++ });
  await impl.deploymentTransaction().wait();
  const implAddr = await impl.getAddress();
  console.log("   impl:", implAddr);

  const router = await hre.ethers.getContractAt("DepositRouter", proxyAddr);
  console.log("2. upgradeToAndCall (nonce " + nonce + ")...");
  const tx = await router.upgradeToAndCall(implAddr, "0x", { ...gas, nonce: nonce++, gasLimit: 250000 });
  console.log("   tx:", tx.hash);
  await tx.wait();

  console.log("VERSION:", await router.VERSION());
  console.log("proxy:", proxyAddr, "| impl:", implAddr);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
