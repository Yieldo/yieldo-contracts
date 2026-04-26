// Sanity-check every token in DepositModal.ALL_TOKENS — verify each address
// is a real ERC-20 on its chain (calls symbol/decimals via balanceOf-style
// view) and reports any that silently fail to read. Catches the class of bug
// where the deposit modal shows a token but balance never loads because the
// address is wrong / from testnet / not yet deployed.
require("dotenv").config();
const { JsonRpcProvider, Contract } = require("ethers");

// Mirror of DepositModal.jsx ALL_TOKENS — keep in sync if you add chains/tokens
const ALL_TOKENS = {
  1:    [["USDC","0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",6],["USDT","0xdAC17F958D2ee523a2206206994597C13D831ec7",6],["WETH","0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",18],["WBTC","0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",8]],
  8453: [["USDC","0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",6],["WETH","0x4200000000000000000000000000000000000006",18]],
  42161:[["USDC","0xaf88d065e77c8cC2239327C5EDb3A432268e5831",6],["USDT","0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",6],["WETH","0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",18]],
  10:   [["USDC","0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",6]],
  143:  [["USDC","0x754704Bc059F8C67012fEd69BC8A327a5aafb603",6],["AUSD","0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",6],["WETH","0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242",18]],
  999:  [["USDC","0xb88339CB7199b77E23DB6E890353E22632Ba630f",6],["USDT","0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb",6]],
};

const RPCS = {
  1:    process.env.ETHEREUM_RPC_URL,
  8453: process.env.BASE_RPC_URL    || "https://mainnet.base.org",
  42161:process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
  10:   process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io",
  143:  process.env.MONAD_RPC_URL    || "https://rpc.monad.xyz",
  999:  process.env.HYPEREVM_RPC_URL || "https://rpc.hyperliquid.xyz/evm",
};

async function main() {
  const ABI = ["function symbol() view returns (string)", "function decimals() view returns (uint8)"];
  let bad = 0, ok = 0;
  for (const [chainId, tokens] of Object.entries(ALL_TOKENS)) {
    if (!RPCS[chainId]) continue;
    const p = new JsonRpcProvider(RPCS[chainId], Number(chainId));
    console.log(`\n=== Chain ${chainId} ===`);
    for (const [feSym, addr, feDec] of tokens) {
      try {
        const c = new Contract(addr, ABI, p);
        const [chainSym, chainDec] = await Promise.all([c.symbol(), c.decimals()]);
        const symMatch = chainSym.toUpperCase() === feSym.toUpperCase();
        const decMatch = Number(chainDec) === feDec;
        if (symMatch && decMatch) {
          console.log(`  ok  ${feSym.padEnd(8)}  ${addr}`);
          ok++;
        } else {
          console.log(`  ??  ${feSym.padEnd(8)}  ${addr}  fe=(${feSym},${feDec})  chain=(${chainSym},${chainDec})`);
          bad++;
        }
      } catch (e) {
        console.log(`  X   ${feSym.padEnd(8)}  ${addr}  -- ${(e.shortMessage || "no contract").slice(0, 60)}`);
        bad++;
      }
    }
  }
  console.log(`\n${bad === 0 ? "All tokens verified" : `${bad} broken / ${ok} ok — fix DepositModal.jsx ALL_TOKENS`}`);
}
main().catch(e => { console.error(e); process.exit(1); });
