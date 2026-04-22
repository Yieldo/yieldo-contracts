const hre = require("hardhat");
async function main() {
  const provider = hre.ethers.provider;
  const addr = "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64";
  const code = await provider.getCode(addr);
  console.log("network:", hre.network.name);
  console.log("addr:   ", addr);
  console.log("code size:", (code.length - 2) / 2, "bytes");

  // try common LiFi interface functions
  const tries = [
    ["function owner() view returns (address)", "owner()"],
    ["function erc20Proxy() view returns (address)", "erc20Proxy()"],
    ["function sgReceiver() view returns (address)", "sgReceiver()"],
  ];
  for (const [abi, name] of tries) {
    try {
      const c = new hre.ethers.Contract(addr, [abi], provider);
      const r = await c[name.split("(")[0]]();
      console.log(`  ${name} →`, r);
    } catch {}
  }
}
main().catch(console.error);
