// Verify what's actually deployed on Katana — fetch on-chain bytecode and ERC-1967 impl slot directly.
const hre = require("hardhat");

const ERC1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const PROXY = "0xa682CD1c2Fd7c8545b401824096A600C2bD98F69";

async function main() {
  // Read the actual impl address from the ERC-1967 slot on the proxy
  const slotVal = await hre.ethers.provider.getStorage(PROXY, ERC1967_IMPL_SLOT);
  const implAddr = hre.ethers.getAddress("0x" + slotVal.slice(-40));
  console.log("Proxy:         ", PROXY);
  console.log("ERC-1967 impl: ", implAddr);

  // Fetch the runtime bytecode at that impl
  const code = await hre.ethers.provider.getCode(implAddr);
  console.log("Impl code size:", (code.length - 2) / 2, "bytes");

  // Search the on-chain bytecode for version strings (hex-encoded ASCII)
  const bc = code.toLowerCase();
  for (const v of ["3.0.0", "3.1.0"]) {
    const hex = Buffer.from(v).toString("hex");
    console.log(`  "${v}" (${hex}) in on-chain bytecode:`, bc.includes(hex));
  }

  // Call VERSION() directly on the impl (bypasses proxy, confirms impl-side string)
  const impl = new hre.ethers.Contract(implAddr, ["function VERSION() view returns (string)"], hre.ethers.provider);
  try {
    console.log("Impl.VERSION():", await impl.VERSION());
  } catch (e) {
    console.log("Impl.VERSION() failed:", e.message);
  }

  // Call VERSION() via the proxy
  const proxy = new hre.ethers.Contract(PROXY, ["function VERSION() view returns (string)"], hre.ethers.provider);
  try {
    console.log("Proxy.VERSION():", await proxy.VERSION());
  } catch (e) {
    console.log("Proxy.VERSION() failed:", e.message);
  }

  // Raw selector call as a sanity check
  const selector = hre.ethers.id("VERSION()").slice(0, 10);
  const raw = await hre.ethers.provider.call({ to: PROXY, data: selector });
  console.log("Raw eth_call proxy:", raw);
  const rawImpl = await hre.ethers.provider.call({ to: implAddr, data: selector });
  console.log("Raw eth_call impl: ", rawImpl);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); });
