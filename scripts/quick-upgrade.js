const hre = require("hardhat");
async function main() {
  const network = hre.network.name;
  const proxyAddress = network === "mainnet"
    ? "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d"
    : "0xF6B7723661d52E8533c77479d3cad534B4D147Aa"; // Base

  const SIGNER = "0xfec5605bbe005BE171E1F0fC3C8d4d90f05a0fDa";

  console.log(`Upgrading DepositRouter on ${network} (V2.4 — per-txn fee + backend signer)...`);
  console.log("Proxy:", proxyAddress);

  const DepositRouter = await hre.ethers.getContractFactory("DepositRouter");
  const upgraded = await hre.upgrades.upgradeProxy(proxyAddress, DepositRouter, {
    unsafeAllow: ["constructor"],
    unsafeSkipStorageCheck: true,
    call: { fn: "reinitializeV3", args: [SIGNER] },
  });
  await upgraded.waitForDeployment();
  const newImpl = await upgraded.getImplementation();
  console.log("Upgraded! New implementation:", newImpl);

  // Verify signer was set
  const signerOnChain = await upgraded.signer();
  console.log("Signer set to:", signerOnChain);
  console.log("Version:", await upgraded.VERSION());
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
