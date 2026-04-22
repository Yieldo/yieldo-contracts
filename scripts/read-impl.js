const hre = require("hardhat");
async function main() {
  const addr = process.env.ADDR;
  const r = await hre.ethers.provider.call({ to: addr, data: "0xffa1ad74" });
  if (r === "0x") { console.log(addr, "→ no code or no VERSION"); return; }
  try {
    const v = hre.ethers.AbiCoder.defaultAbiCoder().decode(["string"], r)[0];
    console.log(addr, "→", v);
  } catch { console.log(addr, "→ raw:", r); }
  const code = await hre.ethers.provider.getCode(addr);
  console.log("code size:", (code.length - 2) / 2);
}
main().catch(console.error);
