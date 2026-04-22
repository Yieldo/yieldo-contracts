const hre = require("hardhat");
async function main() {
  const [s] = await hre.ethers.getSigners();
  const proxy = "0xF6B7723661d52E8533c77479d3cad534B4D147Aa";
  const newImpl = "0xf55889e8b93F380Ba2915461516ca446EAb13D7A";
  const provider = hre.ethers.provider;

  // check owner
  const ownRes = await provider.call({ to: proxy, data: "0x8da5cb5b" });
  const owner = hre.ethers.AbiCoder.defaultAbiCoder().decode(["address"], ownRes)[0];
  console.log("owner:   ", owner);
  console.log("signer:  ", s.address);

  // check impl has code
  const code = await provider.getCode(newImpl);
  console.log("impl code:", code.length > 2 ? "present" : "MISSING");

  // try static call upgradeToAndCall
  const iface = new hre.ethers.Interface([
    "function upgradeToAndCall(address newImplementation, bytes calldata data) external payable"
  ]);
  const data = iface.encodeFunctionData("upgradeToAndCall", [newImpl, "0x"]);
  try {
    await provider.call({ from: s.address, to: proxy, data });
    console.log("sim: ok");
  } catch (e) {
    console.log("sim err:", e.shortMessage || e.message);
    if (e.data) console.log("revert data:", e.data);
  }
}
main().catch(console.error);
