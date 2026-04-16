const { ethers } = require("hardhat");

async function main() {
  const provider = new ethers.JsonRpcProvider("https://rpc.monad.xyz");
  const proxy = "0xD0943c76ee287793559c1dF82E5B2B858Dd01Ef3";
  const impl = "0x59b0b84371bb3261fad538c512efffc414cc1725";
  const ROUTER = "0xCD8dfD627A3712C9a2B079398e0d524970D5E73F";
  const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";

  // Try a broader range of functions — maybe it's not standard ERC-4626
  const sel = (sig) => ethers.id(sig).slice(0, 10);
  const selectors = [
    "name()", "symbol()", "decimals()", "totalSupply()", "totalAssets()", "asset()",
    "paused()", "owner()",
    "maxDeposit(address)", "previewDeposit(uint256)", "deposit(uint256,address)",
    "maxMint(address)", "previewMint(uint256)", "mint(uint256,address)",
    "maxWithdraw(address)", "previewWithdraw(uint256)",
    "maxRedeem(address)", "previewRedeem(uint256)",
    "convertToAssets(uint256)", "convertToShares(uint256)",
    "balanceOf(address)",
    // Morpho-specific
    "MORPHO()", "morpho()", "fee()", "guardian()", "curator()", "skimRecipient()",
    // Init variants
    "initialize(address,address,uint256,address,string,string)",
  ];

  console.log(`=== Probing proxy ${proxy} ===\n`);
  for (const s of selectors) {
    const data = sel(s) + "0".repeat(s.includes("(address)") ? 64 : s.includes("(uint256)") ? 64 : 0);
    try {
      const result = await provider.call({ to: proxy, data });
      console.log(`  ${s.padEnd(60)} -> ${result.length > 66 ? result.slice(0,66)+"..." : result}`);
    } catch (e) {
      const msg = e.data || e.shortMessage || "revert";
      console.log(`  ${s.padEnd(60)} -> REVERT (${msg.slice(0,40)})`);
    }
  }

  console.log(`\n=== Checking impl ${impl} directly ===`);
  const name = await provider.call({ to: impl, data: sel("name()") }).catch(e => "REVERT");
  console.log(`  name() direct: ${name.slice(0,80)}`);

  // Look for recent deposits to this vault in last 1000 blocks
  console.log(`\n=== Recent Transfer events to proxy ===`);
  const latest = await provider.getBlockNumber();
  const logs = await provider.getLogs({
    address: USDC,
    topics: [
      ethers.id("Transfer(address,address,uint256)"),
      null,
      ethers.zeroPadValue(proxy, 32),
    ],
    fromBlock: latest - 2000,
    toBlock: latest,
  });
  console.log(`  USDC->proxy transfers in last 2000 blocks: ${logs.length}`);
  for (const l of logs.slice(0, 5)) {
    console.log(`    block=${l.blockNumber} tx=${l.transactionHash}`);
  }

  console.log(`\n=== All logs emitted BY proxy in last 2000 blocks ===`);
  const outLogs = await provider.getLogs({
    address: proxy,
    fromBlock: latest - 2000,
    toBlock: latest,
  });
  console.log(`  Events from proxy: ${outLogs.length}`);
  for (const l of outLogs.slice(0, 5)) {
    console.log(`    block=${l.blockNumber} topic0=${l.topics[0]}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
