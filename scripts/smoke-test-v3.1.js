// Same-chain smoke test for V3.1.0 — run AFTER upgrade-v3.1.js on a chain.
//
// Usage: VAULT=0x... AMOUNT=1000000 npx hardhat run scripts/smoke-test-v3.1.js --network <name>
//   VAULT  = address of a configured ERC-4626 Morpho vault on that chain (any works)
//   AMOUNT = deposit size in the asset's smallest unit (default: 1 USDC = 1_000_000)
//
// What it does:
//   1. Reads vault.asset() to discover the asset token
//   2. Ensures deployer has AMOUNT balance + approval to router
//   3. Calls depositFor(vault, asset, amount, deployer, partnerId=0x0..0, partnerType=0, isERC4626=true)
//      (uses the 7-arg compat overload — exactly what V3.0 backend emits today)
//   4. Parses the Routed event and asserts shares > 0
//   5. Prints the tx hash and gas used
//
// Why the 7-arg overload? We want to validate that the compatibility shim works against real
// production traffic shape. If this passes, the current backend can deposit into V3.1 with no
// code change.

const hre = require("hardhat");

const PROXIES = {
  mainnet:  "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d",
  base:     "0xF6B7723661d52E8533c77479d3cad534B4D147Aa",
  arbitrum: "0xC5700f4D8054BA982C39838D7C33442f54688bd2",
  optimism: "0x7554937Aa95195D744A6c45E0fd7D4F95A2F8F72",
  monad:    "0xCD8dfD627A3712C9a2B079398e0d524970D5E73F",
  katana:   "0xa682CD1c2Fd7c8545b401824096A600C2bD98F69",
};

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

const ROUTER_ABI = [
  "function VERSION() view returns (string)",
  "function depositFor(address vault, address asset, uint256 amount, address user, bytes32 partnerId, uint8 partnerType, bool isERC4626)",
  "event Routed(bytes32 indexed partnerId, uint8 partnerType, address indexed user, address indexed vault, address asset, uint256 amount, uint256 shares)",
];

const VAULT_ABI = [
  "function asset() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
];

async function main() {
  const network = hre.network.name;
  const proxy = PROXIES[network];
  if (!proxy) throw new Error(`No router on network ${network}`);

  const vaultAddr = process.env.VAULT;
  if (!vaultAddr) throw new Error("Set VAULT=0x... env var (an ERC-4626 vault configured on this chain).");
  const amount = BigInt(process.env.AMOUNT || "1000000");

  const [deployer] = await hre.ethers.getSigners();
  console.log(`\n=== Smoke test on ${network} ===`);
  console.log("Signer:  ", deployer.address);
  console.log("Router:  ", proxy);
  console.log("Vault:   ", vaultAddr);

  const router = new hre.ethers.Contract(proxy, ROUTER_ABI, deployer);
  console.log("VERSION: ", await router.VERSION());

  const vault = new hre.ethers.Contract(vaultAddr, VAULT_ABI, hre.ethers.provider);
  const assetAddr = await vault.asset();
  const asset = new hre.ethers.Contract(assetAddr, ERC20_ABI, deployer);
  const sym = await asset.symbol();
  const dec = await asset.decimals();
  console.log(`Asset:    ${assetAddr} (${sym}, ${dec} decimals)`);
  console.log(`Amount:   ${amount} (${hre.ethers.formatUnits(amount, dec)} ${sym})`);

  // Funding check
  const bal = await asset.balanceOf(deployer.address);
  if (bal < amount) {
    throw new Error(`Insufficient ${sym}: have ${bal}, need ${amount}. Fund deployer first.`);
  }

  // Approval
  const allowance = await asset.allowance(deployer.address, proxy);
  if (allowance < amount) {
    console.log("Approving router...");
    const tx0 = await asset.approve(proxy, amount);
    await tx0.wait();
    console.log("Approval tx:", tx0.hash);
  }

  const sharesBefore = await vault.balanceOf(deployer.address);

  // 7-arg call — mimics what production backend emits today.
  console.log("\nCalling depositFor (7-arg compat shim)...");
  const tx = await router["depositFor(address,address,uint256,address,bytes32,uint8,bool)"](
    vaultAddr,
    assetAddr,
    amount,
    deployer.address,
    "0x0000000000000000000000000000000000000000000000000000000000000000",
    0,
    true,
  );
  console.log("Deposit tx:", tx.hash);
  const rcpt = await tx.wait();
  console.log("Gas used:  ", rcpt.gasUsed.toString());

  // Parse Routed event
  const iface = new hre.ethers.Interface(ROUTER_ABI);
  let routed = null;
  for (const log of rcpt.logs) {
    if (log.address.toLowerCase() !== proxy.toLowerCase()) continue;
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === "Routed") { routed = parsed; break; }
    } catch {}
  }
  if (!routed) throw new Error("No Routed event found — upgrade may not have taken effect.");

  console.log("\nRouted event:");
  console.log("  partnerId:  ", routed.args.partnerId);
  console.log("  partnerType:", routed.args.partnerType);
  console.log("  user:       ", routed.args.user);
  console.log("  vault:      ", routed.args.vault);
  console.log("  asset:      ", routed.args.asset);
  console.log("  amount:     ", routed.args.amount.toString());
  console.log("  shares:     ", routed.args.shares.toString());

  if (routed.args.shares === 0n) throw new Error("shares == 0 — deposit failed silently.");

  const sharesAfter = await vault.balanceOf(deployer.address);
  const delivered = sharesAfter - sharesBefore;
  console.log(`\nVault shares delivered to deployer: ${delivered}`);
  if (delivered < routed.args.shares) {
    throw new Error(`Event reports ${routed.args.shares} shares but only ${delivered} reached deployer.`);
  }

  console.log("\n✓ Smoke test passed.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); });
