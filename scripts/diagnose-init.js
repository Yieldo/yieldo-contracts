// Read the OZ Initializable namespaced storage to find current _initialized version.
const hre = require("hardhat");

const PROXY_BY_NETWORK = {
  mainnet:     "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d",
  base:        "0xF6B7723661d52E8533c77479d3cad534B4D147Aa",
  arbitrum:    "0xC5700f4D8054BA982C39838D7C33442f54688bd2",
  optimism:    "0x7554937Aa95195D744A6c45E0fd7D4F95A2F8F72",
  monad:       "0xCD8dfD627A3712C9a2B079398e0d524970D5E73F",
  hyperliquid: "0xa682CD1c2Fd7c8545b401824096A600C2bD98F69",
};

// keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.Initializable")) - 1)) & ~bytes32(uint256(0xff))
const INIT_SLOT = "0xf0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a00";

async function main() {
  const network = hre.network.name;
  const proxy = PROXY_BY_NETWORK[network];
  if (!proxy) throw new Error(`No proxy for ${network}`);

  const raw = await hre.ethers.provider.getStorage(proxy, INIT_SLOT);
  const asBigInt = BigInt(raw);
  // Layout: _initialized (uint64) at low 8 bytes, _initializing (bool) at byte 8
  const initialized = Number(asBigInt & 0xffffffffffffffffn);
  const initializing = Number((asBigInt >> 64n) & 0x01n);
  console.log(`Network:     ${network}`);
  console.log(`Proxy:       ${proxy}`);
  console.log(`Init slot:   ${raw}`);
  console.log(`_initialized: ${initialized}`);
  console.log(`_initializing: ${initializing}`);

  // Also check slot 0 to see if we're in old (RG._status at slot 0) or new (mapping at slot 0) layout
  const slot0 = await hre.ethers.provider.getStorage(proxy, "0x0");
  console.log(`Slot 0:      ${slot0}  (0x0 means namespaced-RG; non-zero means old non-namespaced RG._status)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
