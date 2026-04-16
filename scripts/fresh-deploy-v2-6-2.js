/**
 * Fresh V2.6.2 deployment on a new chain: impl + ERC1967Proxy, then bring
 * _initialized up to v4 (setOracle(0) + reinitializeV3(signer) + reinitializeV4()).
 *
 *   npx hardhat run scripts/fresh-deploy-v2-6-2.js --network <name>
 */
require("dotenv").config();
const { ethers } = require("ethers");

const FEE_COLLECTOR = "0xBEb2986BD5b7ADDB360D0BbdAD9a7DE21854F427";
const SIGNER = "0xfec5605bbe005BE171E1F0fC3C8d4d90f05a0fDa";

async function main() {
  const hre = require("hardhat");
  const net = hre.network.name;
  const p = hre.ethers.provider;
  const [deployer] = await hre.ethers.getSigners();
  const chainId = Number((await p.getNetwork()).chainId);
  console.log(`Fresh V2.6.2 deploy on ${net} (chain ${chainId})`);
  console.log("Deployer:", deployer.address);

  const bal = await p.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(bal));

  const fees = await p.getFeeData();
  const baseFee = fees.gasPrice - (fees.maxPriorityFeePerGas || 0n);
  // Per-chain priority tuning: Monad/Hyperliquid need higher (1 gwei), Katana ultra-low ($0.04 balance), others 0.02 gwei
  const priorityGwei = ["monad", "hyperliquid"].includes(net) ? "1" : net === "katana" ? "0.001" : "0.02";
  const priority = ethers.parseUnits(priorityGwei, "gwei");
  const maxFee = (baseFee * 13n) / 10n + priority;
  const gas = { maxPriorityFeePerGas: priority, maxFeePerGas: maxFee };
  const legacyGas = { gasPrice: fees.gasPrice + priority };
  const useLegacy = ["hyperliquid"].includes(net);
  const gasOv = useLegacy ? legacyGas : gas;
  console.log(`Gas: base ${ethers.formatUnits(baseFee, "gwei")} gwei | priority ${priorityGwei} gwei | tx type:`, useLegacy ? "legacy" : "1559");

  let nonce = await p.getTransactionCount(deployer.address, "latest");
  const routerArt = await hre.artifacts.readArtifact("DepositRouter");
  const proxyArt = await hre.artifacts.readArtifact("ERC1967Proxy");

  console.log("\n1. Deploy impl (nonce " + nonce + ")...");
  const Factory = new ethers.ContractFactory(routerArt.abi, routerArt.bytecode, deployer);
  // Some chains (e.g. Katana) enforce EIP-7623 calldata-floor cost which estimateGas
  // undershoots. Explicit 5_500_000 covers 21KB contract init code safely.
  const impl = await Factory.deploy({ ...gasOv, nonce: nonce++, gasLimit: 5_500_000 });
  await impl.deploymentTransaction().wait();
  const implAddr = await impl.getAddress();
  console.log("   impl:", implAddr);

  console.log("\n2. Deploy proxy with initialize() (nonce " + nonce + ")...");
  const iface = new ethers.Interface(routerArt.abi);
  const initData = iface.encodeFunctionData("initialize", [FEE_COLLECTOR, FEE_COLLECTOR]);
  const proxyFactory = new ethers.ContractFactory(proxyArt.abi, proxyArt.bytecode, deployer);
  const proxy = await proxyFactory.deploy(implAddr, initData, { ...gasOv, nonce: nonce++ });
  await proxy.deploymentTransaction().wait();
  const proxyAddr = await proxy.getAddress();
  console.log("   proxy:", proxyAddr);

  const router = new ethers.Contract(proxyAddr, routerArt.abi, deployer);

  console.log("\n3. setOracle(0) (nonce " + nonce + ")...");
  let tx = await router.setOracle(ethers.ZeroAddress, { ...gasOv, nonce: nonce++ });
  await tx.wait();

  console.log("4. reinitializeV3(signer) (nonce " + nonce + ")...");
  tx = await router.reinitializeV3(SIGNER, { ...gasOv, nonce: nonce++ });
  await tx.wait();

  console.log("5. reinitializeV4() (nonce " + nonce + ")...");
  tx = await router.reinitializeV4({ ...gasOv, nonce: nonce++ });
  await tx.wait();

  console.log("\n=== Live on", net, "===");
  console.log("VERSION:          ", await router.VERSION());
  console.log("owner:            ", await router.owner());
  console.log("signer:           ", await router.signer());
  console.log("referralSplitBps: ", (await router.referralSplitBps()).toString());
  console.log("proxy:", proxyAddr);
  console.log("impl: ", implAddr);

  const afterBal = await p.getBalance(deployer.address);
  console.log("Spent:", ethers.formatEther(bal - afterBal), "ETH (leftover:", ethers.formatEther(afterBal) + ")");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
