const { ethers } = require("hardhat");

async function main() {
  const provider = new ethers.JsonRpcProvider("https://rpc.monad.xyz");
  const ROUTER = "0xCD8dfD627A3712C9a2B079398e0d524970D5E73F";
  const addr = ethers.getAddress("0x7Cd231120a60F500887444a9bAF5e1BD753A5e59");

  const code = await provider.getCode(addr);
  console.log(`addr: ${addr}`);
  console.log(`code: ${(code.length - 2) / 2} bytes`);

  const ABI = [
    "function asset() view returns (address)",
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function totalAssets() view returns (uint256)",
    "function totalSupply() view returns (uint256)",
    "function maxDeposit(address) view returns (uint256)",
    "function previewDeposit(uint256) view returns (uint256)",
    "function decimals() view returns (uint8)",
  ];
  const c = new ethers.Contract(addr, ABI, provider);
  const probe = async (l, fn) => { try { console.log(`  ${l}: ${await fn()}`);} catch(e){ console.log(`  ${l}: REVERT`);} };
  await probe("asset", () => c.asset());
  await probe("name", () => c.name());
  await probe("symbol", () => c.symbol());
  await probe("decimals", () => c.decimals());
  await probe("totalAssets", () => c.totalAssets());
  await probe("totalSupply", () => c.totalSupply());
  await probe("maxDeposit(router)", () => c.maxDeposit(ROUTER));
  await probe("previewDeposit(1e6)", () => c.previewDeposit(1_000_000));
}
main().catch(e => { console.error(e); process.exit(1); });
