const hre = require("hardhat");
async function main() {
  const [signer] = await hre.ethers.getSigners();
  const network = hre.network.name;
  const ROUTERS = { base: "0xF6B7723661d52E8533c77479d3cad534B4D147Aa", arbitrum: "0xC5700f4D8054BA982C39838D7C33442f54688bd2", optimism: "0x7554937Aa95195D744A6c45E0fd7D4F95A2F8F72" };
  const USDC = { base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", optimism: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" };
  const VAULTS = {
    base: "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
    arbitrum: "0x7e97fa6893871A2751B5fE961978DCCb2c201E65",
    optimism: "0xC30ce6A5758786e0F640cC5f881Dd96e9a1C5C59",
  };
  const router = ROUTERS[network];
  const usdc = USDC[network];
  const vault = VAULTS[network];
  const amount = 100000n; // 0.1 USDC — small to avoid running out

  console.log(`\n${network}: router=${router} vault=${vault} amount=${amount}`);

  const ERC20 = ["function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)", "function balanceOf(address) view returns (uint256)"];
  const token = new hre.ethers.Contract(usdc, ERC20, signer);
  const bal = await token.balanceOf(signer.address);
  console.log("Balance:", (Number(bal) / 1e6).toFixed(4), "USDC");
  if (bal < amount) { console.log("Insufficient balance"); return; }

  const cur = await token.allowance(signer.address, router);
  if (cur < amount) {
    console.log("Approving...");
    const tx = await token.approve(router, amount * 100n);
    await tx.wait();
  }

  const ROUTER_ABI = [
    "function depositFor(address vault, address asset, uint256 amount, address user, bytes32 partnerId, uint8 partnerType, bool isERC4626)",
  ];
  const rc = new hre.ethers.Contract(router, ROUTER_ABI, signer);
  const tx = await rc.depositFor(vault, usdc, amount, signer.address,
    "0x0000000000000000000000000000000000000000000000000000000000000000", 0, true,
    { gasLimit: 600000n });
  console.log("Tx:", tx.hash);
  const rcpt = await tx.wait();
  console.log("Status:", rcpt.status, "gas:", rcpt.gasUsed.toString());
}
main().catch(e => console.error("Error:", e.shortMessage || e.message));
