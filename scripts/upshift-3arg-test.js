// Direct test of Upshift's custom 3-arg deposit signature.
// MetaMask UI on app.upshift.finance shows:
//   Method: deposit
//   Param #1: NUSD address    (asset)
//   Param #2: amount
//   Param #3: <address>       (receiver / treasury)
//
// That's NOT ERC-4626's deposit(uint256, address) — it's deposit(address, uint256, address).
//
// Walk:
//   1. Check NUSD balance
//   2. Simulate deposit(NUSD, amount, user) from EOA — check would succeed
//   3. If yes, approve NUSD to vault and send the deposit
require("dotenv").config();
const { Wallet, JsonRpcProvider, Contract, id, parseUnits, formatUnits } = require("ethers");

const provider = new JsonRpcProvider(process.env.ETHEREUM_RPC_URL, 1);
const wallet   = new Wallet(process.env.PRIVATE_KEY, provider);
const VAULT    = "0xAEEb2fB279a5aA837367B9D2582F898a63b06ca1";  // Upshift NUSD
const NUSD     = "0xE556ABa6fe6036275Ec1f87eda296BE72C811BCE";
const AMOUNT   = parseUnits("0.5", 18);  // 0.5 NUSD

const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

async function main() {
  console.log("wallet:", wallet.address);
  const nusd = new Contract(NUSD, ERC20, wallet);
  const bal = await nusd.balanceOf(wallet.address);
  console.log("NUSD balance:", formatUnits(bal, 18));
  if (bal < AMOUNT) throw new Error(`Need ${formatUnits(AMOUNT,18)} NUSD, have ${formatUnits(bal,18)}`);

  // Compute selector for deposit(address,uint256,address)
  const selector = id("deposit(address,uint256,address)").slice(0, 10);
  console.log("\n3-arg deposit selector:", selector);

  // Build calldata: selector + 3 abi-encoded args
  const data = selector +
    "000000000000000000000000" + NUSD.slice(2).toLowerCase() +
    AMOUNT.toString(16).padStart(64, "0") +
    "000000000000000000000000" + wallet.address.slice(2).toLowerCase();

  console.log("\n=== simulate from EOA ===");
  try {
    const r = await provider.call({ from: wallet.address, to: VAULT, data });
    console.log("would succeed, returns:", r);
  } catch (e) {
    const d = e.data || e.info?.error?.data || "";
    console.log("REVERT:", e.shortMessage, "| data:", d.slice(0, 80));
    if (d.startsWith("0x08c379a0")) {
      const { AbiCoder } = require("ethers");
      const decoded = AbiCoder.defaultAbiCoder().decode(["string"], "0x" + d.slice(10));
      console.log("decoded:", decoded[0]);
    }
    process.exit(1);
  }

  // Approve if needed
  const cur = await nusd.allowance(wallet.address, VAULT);
  if (cur < AMOUNT) {
    console.log("\napproving NUSD to vault...");
    const at = await nusd.approve(VAULT, AMOUNT);
    console.log("approve hash:", at.hash);
    await at.wait();
    console.log("approval confirmed");
  } else {
    console.log("\nallowance OK:", formatUnits(cur, 18));
  }

  console.log("\nsending deposit tx...");
  const tx = await wallet.sendTransaction({ to: VAULT, data });
  console.log("hash:", tx.hash);
  console.log("etherscan: https://etherscan.io/tx/" + tx.hash);
  const r = await tx.wait();
  console.log(`${r.status === 1 ? "✓ SUCCESS" : "✗ FAILED"} block ${r.blockNumber}`);
}

main().catch(e => { console.error("FAILED:", e.message || e); process.exit(1); });
