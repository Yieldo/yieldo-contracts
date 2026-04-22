const hre = require("hardhat");
async function main() {
  const [signer] = await hre.ethers.getSigners();
  const router = "0xF6B7723661d52E8533c77479d3cad534B4D147Aa";
  const vault = "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61";
  const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const amount = 1000000n;

  // Approve router
  const ERC20 = ["function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)"];
  const token = new hre.ethers.Contract(usdc, ERC20, signer);
  const cur = await token.allowance(signer.address, router);
  console.log("Current USDC allowance:", cur.toString());
  if (cur < amount) {
    const tx = await token.approve(router, amount * 10n);
    console.log("Approve tx:", tx.hash);
    await tx.wait();
  }

  // Direct call
  const ROUTER_ABI = [
    "function depositFor(address vault, address asset, uint256 amount, address user, bytes32 partnerId, uint8 partnerType, bool isERC4626)",
  ];
  const rc = new hre.ethers.Contract(router, ROUTER_ABI, signer);
  const PARTNER_ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";
  console.log("\nSending depositFor directly...");
  try {
    const tx = await rc.depositFor(vault, usdc, amount, signer.address, PARTNER_ZERO, 0, true, {
      gasLimit: 600000n,
    });
    console.log("Tx:", tx.hash);
    const rcpt = await tx.wait();
    console.log("Status:", rcpt.status, "gas:", rcpt.gasUsed.toString());
  } catch (e) {
    console.log("Error:", e.info?.error?.message || e.shortMessage || e.message);
    // Try to get revert reason via provider.call
    const iface = new hre.ethers.Interface(ROUTER_ABI);
    const data = iface.encodeFunctionData("depositFor", [
      vault, usdc, amount, signer.address, PARTNER_ZERO, 0, true,
    ]);
    try {
      await hre.ethers.provider.call({ from: signer.address, to: router, data });
    } catch (simErr) {
      console.log("Sim error:", simErr.info?.error?.message || simErr.shortMessage || simErr.message);
      console.log("Sim data:", simErr.data);
    }
  }
}
main().catch(console.error);
