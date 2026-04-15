/**
 * V2.6 full deploy: escrow + router impl + (upgrade existing proxy OR fresh deploy).
 *
 * Low priority gas enforced (0.01 gwei) on all networks. Verifies post-deploy state.
 *
 *   npx hardhat run scripts/deploy-v2-6.js --network base
 *   npx hardhat run scripts/deploy-v2-6.js --network mainnet
 *   npx hardhat run scripts/deploy-v2-6.js --network monad
 */
const hre = require("hardhat");

const CFG = {
  mainnet: {
    proxy: "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d",
    reinit: "reinitializeV4",   // mainnet is at V2.5.1 (_initialized=3); bring to 4
    feeCollector: "0xBEb2986BD5b7ADDB360D0BbdAD9a7DE21854F427",
    signer: "0xfec5605bbe005BE171E1F0fC3C8d4d90f05a0fDa",
    priorityGwei: "0.01",
  },
  base: {
    proxy: "0xF6B7723661d52E8533c77479d3cad534B4D147Aa",
    reinit: null,                // base is at V2.5.2 (_initialized=4); no reinit needed
    feeCollector: "0xBEb2986BD5b7ADDB360D0BbdAD9a7DE21854F427",
    signer: "0xfec5605bbe005BE171E1F0fC3C8d4d90f05a0fDa",
    priorityGwei: "0.01",
  },
  monad: {
    proxy: null,                 // fresh deploy
    feeCollector: "0xBEb2986BD5b7ADDB360D0BbdAD9a7DE21854F427",
    signer: "0xfec5605bbe005BE171E1F0fC3C8d4d90f05a0fDa",
    priorityGwei: "1",           // Monad has higher base fee; 1 gwei priority is still tiny
  },
};

async function lowPriorityOverrides(provider, priorityGwei) {
  const fees = await provider.getFeeData();
  const baseFee = fees.gasPrice - (fees.maxPriorityFeePerGas || 0n);
  const priority = hre.ethers.parseUnits(priorityGwei, "gwei");
  return {
    maxPriorityFeePerGas: priority,
    maxFeePerGas: (baseFee * 12n) / 10n + priority,
  };
}

async function main() {
  const net = hre.network.name;
  const cfg = CFG[net];
  if (!cfg) throw new Error(`Unsupported network: ${net}`);
  const [deployer] = await hre.ethers.getSigners();
  const gas = await lowPriorityOverrides(hre.ethers.provider, cfg.priorityGwei);
  console.log(`== Deploy V2.6 on ${net} ==`);
  console.log("Deployer:", deployer.address);
  console.log(`Gas overrides: maxPriorityFeePerGas=${hre.ethers.formatUnits(gas.maxPriorityFeePerGas, "gwei")} gwei, maxFeePerGas=${hre.ethers.formatUnits(gas.maxFeePerGas, "gwei")} gwei`);
  console.log();

  // 1. Deploy WithdrawalEscrow
  console.log("1. Deploying WithdrawalEscrow impl...");
  const Escrow = await hre.ethers.getContractFactory("WithdrawalEscrow");
  const escrow = await Escrow.deploy(gas);
  await escrow.waitForDeployment();
  const escrowAddr = await escrow.getAddress();
  console.log("   escrow:", escrowAddr);

  // 2. Deploy DepositRouter impl
  console.log("\n2. Deploying DepositRouter impl (V2.6)...");
  const Router = await hre.ethers.getContractFactory("DepositRouter");
  const impl = await Router.deploy(gas);
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log("   impl:", implAddr);

  let proxyAddr;

  if (cfg.proxy) {
    // Upgrade existing proxy
    console.log("\n3. Upgrading proxy", cfg.proxy);
    const router = await hre.ethers.getContractAt("DepositRouter", cfg.proxy);
    const initData = cfg.reinit
      ? Router.interface.encodeFunctionData(cfg.reinit, [])
      : "0x";
    console.log("   reinit call:", cfg.reinit || "(none)");
    const tx = await router.upgradeToAndCall(implAddr, initData, { ...gas, gasLimit: 200000 });
    console.log("   upgrade tx:", tx.hash);
    await tx.wait();
    proxyAddr = cfg.proxy;
  } else {
    // Fresh deploy: ERC1967 proxy
    console.log("\n3. Deploying ERC1967Proxy with initialize()...");
    const ERC1967 = await hre.ethers.getContractFactory("ERC1967Proxy");
    const initData = Router.interface.encodeFunctionData("initialize", [
      cfg.feeCollector,
      cfg.feeCollector,    // placeholder oracle (non-zero required by initialize); setOracle(0) next
    ]);
    const proxy = await ERC1967.deploy(implAddr, initData, gas);
    await proxy.waitForDeployment();
    proxyAddr = await proxy.getAddress();
    console.log("   proxy:", proxyAddr);

    const router = await hre.ethers.getContractAt("DepositRouter", proxyAddr);

    console.log("\n4. Disabling oracle (Monad has no Pyth yet)...");
    const tx1 = await router.setOracle("0x0000000000000000000000000000000000000000", gas);
    await tx1.wait();

    console.log("5. reinitializeV3(signer)...");
    const tx2 = await router.reinitializeV3(cfg.signer, gas);
    await tx2.wait();

    console.log("6. reinitializeV4()...");
    const tx3 = await router.reinitializeV4(gas);
    await tx3.wait();
  }

  // 4/7. setWithdrawEscrowImpl
  console.log("\n" + (cfg.proxy ? "4" : "7") + ". setWithdrawEscrowImpl...");
  const router = await hre.ethers.getContractAt("DepositRouter", proxyAddr);
  const tx4 = await router.setWithdrawEscrowImpl(escrowAddr, gas);
  console.log("   tx:", tx4.hash);
  await tx4.wait();

  // Verify state
  console.log("\n=== Verify ===");
  console.log("VERSION:             ", await router.VERSION());
  console.log("owner:               ", await router.owner());
  console.log("signer:              ", await router.signer());
  console.log("referralSplitBps:    ", (await router.referralSplitBps()).toString());
  console.log("withdrawEscrowImpl:  ", await router.withdrawEscrowImpl());
  console.log();
  console.log("Proxy:", proxyAddr);
  console.log("Impl: ", implAddr);
  console.log("Escrow impl:", escrowAddr);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
