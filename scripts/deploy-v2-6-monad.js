/**
 * Fresh Monad deployment: escrow + impl + ERC1967Proxy + full init sequence.
 * No oracle on Monad yet — initialize with placeholder, then setOracle(0).
 */
require("dotenv").config();
const { ethers } = require("ethers");

const FEE_COLLECTOR = "0xBEb2986BD5b7ADDB360D0BbdAD9a7DE21854F427";
const SIGNER = "0xfec5605bbe005BE171E1F0fC3C8d4d90f05a0fDa";

async function main() {
  const hre = require("hardhat");
  const rpc = process.env.MONAD_RPC_URL || "https://rpc.monad.xyz";
  const p = new ethers.JsonRpcProvider(rpc);
  const w = new ethers.Wallet(process.env.PRIVATE_KEY, p);

  const bal = await p.getBalance(w.address);
  console.log("Deployer:", w.address, "| MON:", ethers.formatEther(bal));

  const fee = await p.getFeeData();
  const gas = fee.gasPrice + ethers.parseUnits("1", "gwei");
  console.log("gasPrice:", ethers.formatUnits(gas, "gwei"), "gwei\n");

  let nonce = await p.getTransactionCount(w.address, "latest");

  const escrowArt = await hre.artifacts.readArtifact("WithdrawalEscrow");
  const routerArt = await hre.artifacts.readArtifact("DepositRouter");
  const proxyArt = await hre.artifacts.readArtifact("ERC1967Proxy");

  // 1. Escrow
  console.log("1. Deploy WithdrawalEscrow (nonce " + nonce + ")...");
  const escrow = await new ethers.ContractFactory(escrowArt.abi, escrowArt.bytecode, w)
    .deploy({ nonce: nonce++, gasPrice: gas });
  await escrow.deploymentTransaction().wait();
  const escrowAddr = await escrow.getAddress();
  console.log("   escrow:", escrowAddr);

  // 2. Impl
  console.log("\n2. Deploy DepositRouter impl (nonce " + nonce + ")...");
  const impl = await new ethers.ContractFactory(routerArt.abi, routerArt.bytecode, w)
    .deploy({ nonce: nonce++, gasPrice: gas });
  await impl.deploymentTransaction().wait();
  const implAddr = await impl.getAddress();
  console.log("   impl:", implAddr);

  // 3. Proxy with initialize(feeCollector, placeholder_oracle)
  const iface = new ethers.Interface(routerArt.abi);
  const initData = iface.encodeFunctionData("initialize", [FEE_COLLECTOR, FEE_COLLECTOR]);
  console.log("\n3. Deploy ERC1967Proxy (nonce " + nonce + ")...");
  const proxy = await new ethers.ContractFactory(proxyArt.abi, proxyArt.bytecode, w)
    .deploy(implAddr, initData, { nonce: nonce++, gasPrice: gas });
  await proxy.deploymentTransaction().wait();
  const proxyAddr = await proxy.getAddress();
  console.log("   proxy:", proxyAddr);

  const router = new ethers.Contract(proxyAddr, routerArt.abi, w);

  // 4. Disable oracle (Monad has no Pyth)
  console.log("\n4. setOracle(0) (nonce " + nonce + ")...");
  const tx4 = await router.setOracle(ethers.ZeroAddress, { nonce: nonce++, gasPrice: gas });
  await tx4.wait();

  // 5. reinitializeV3(signer) — bumps _initialized to 3
  console.log("5. reinitializeV3(signer) (nonce " + nonce + ")...");
  const tx5 = await router.reinitializeV3(SIGNER, { nonce: nonce++, gasPrice: gas });
  await tx5.wait();

  // 6. reinitializeV4() — bumps to 4, sets referralSplitBps=5000
  console.log("6. reinitializeV4() (nonce " + nonce + ")...");
  const tx6 = await router.reinitializeV4({ nonce: nonce++, gasPrice: gas });
  await tx6.wait();

  // 7. setWithdrawEscrowImpl
  console.log("7. setWithdrawEscrowImpl (nonce " + nonce + ")...");
  const tx7 = await router.setWithdrawEscrowImpl(escrowAddr, { nonce: nonce++, gasPrice: gas });
  await tx7.wait();

  console.log("\n=== Monad V2.6 operational ===");
  console.log("VERSION:           ", await router.VERSION());
  console.log("owner:             ", await router.owner());
  console.log("signer:            ", await router.signer());
  console.log("referralSplitBps:  ", (await router.referralSplitBps()).toString());
  console.log("withdrawEscrowImpl:", await router.withdrawEscrowImpl());
  console.log("Proxy:", proxyAddr);
  console.log("Impl: ", implAddr);
  console.log("Escrow:", escrowAddr);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
