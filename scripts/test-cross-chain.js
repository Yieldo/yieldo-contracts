const { ethers } = require("ethers");
const http = require("http");

require("dotenv").config();
const pk = process.env.PRIVATE_KEY;
const API_BASE = "http://localhost:8000";

const CHAINS = {
  43114: { name: "Avalanche", rpc: "https://api.avax.network/ext/bc/C/rpc", usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", explorer: "https://snowtrace.io/tx/" },
  10: { name: "Optimism", rpc: "https://mainnet.optimism.io", usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", explorer: "https://optimistic.etherscan.io/tx/" },
};

const ERC20_ABI = [
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
];

function apiCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: { "Content-Type": "application/json" },
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`API error: ${data}`)); }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function signEIP712(wallet, eip712) {
  const { domain, types, message } = eip712;
  // Remove EIP712Domain from types if present
  const sigTypes = { ...types };
  delete sigTypes.EIP712Domain;
  return wallet.signTypedData(domain, sigTypes, message);
}

async function doCrossChainDeposit(chainId, vaultId, amountUsdc) {
  const chain = CHAINS[chainId];
  console.log(`\n${"=".repeat(60)}`);
  console.log(`${chain.name} (${chainId}) → Base vault ${vaultId}`);
  console.log(`Amount: ${amountUsdc} USDC`);
  console.log("=".repeat(60));

  const provider = new ethers.JsonRpcProvider(chain.rpc);
  const wallet = new ethers.Wallet(pk, provider);
  const amountRaw = (amountUsdc * 1e6).toString();

  // Step 1: Get quote
  console.log("\n1. Getting quote...");
  const quote = await apiCall("POST", "/v1/quote", {
    from_chain_id: chainId,
    from_token: chain.usdc,
    from_amount: amountRaw,
    vault_id: vaultId,
    user_address: wallet.address,
    slippage: 0.03,
  });

  if (quote.detail || quote.error) {
    console.error("Quote error:", JSON.stringify(quote));
    return null;
  }

  console.log("   Quote type:", quote.quote_type);
  console.log("   From:", quote.estimate.from_amount, "→ To:", quote.estimate.to_amount);
  console.log("   Fee:", quote.estimate.fee_amount);
  console.log("   Intent amount:", quote.intent.amount);
  console.log("   Nonce:", quote.intent.nonce);

  // Step 2: Sign EIP-712
  console.log("\n2. Signing EIP-712...");
  const signature = await signEIP712(wallet, quote.eip712);
  console.log("   Signature:", signature.slice(0, 20) + "...");

  // Step 3: Build transaction
  console.log("\n3. Building transaction...");
  const buildReq = {
    signature,
    nonce: quote.intent.nonce,
    deadline: quote.intent.deadline,
    intent_amount: quote.intent.amount,
    from_chain_id: chainId,
    from_token: chain.usdc,
    from_amount: amountRaw,
    vault_id: vaultId,
    user_address: wallet.address,
    slippage: 0.03,
  };
  const build = await apiCall("POST", "/v1/quote/build", buildReq);

  if (build.detail || build.error) {
    console.error("Build error:", JSON.stringify(build));
    return null;
  }

  const txReq = build.transaction_request;
  console.log("   To:", txReq.to);
  console.log("   Value:", txReq.value);
  console.log("   Chain:", txReq.chain_id);

  // Step 4: Approve if needed
  if (build.approval) {
    const usdc = new ethers.Contract(build.approval.token_address, ERC20_ABI, wallet);
    const currentAllowance = await usdc.allowance(wallet.address, build.approval.spender_address);
    const needed = BigInt(build.approval.amount);
    if (currentAllowance < needed) {
      console.log("\n4. Approving", build.approval.spender_address, "for", build.approval.amount);
      const appTx = await usdc.approve(build.approval.spender_address, needed * 10n); // 10x for future
      console.log("   Approve tx:", appTx.hash);
      await appTx.wait();
      console.log("   Approved!");
    } else {
      console.log("\n4. Already approved");
    }
  }

  // Step 5: Send transaction
  console.log("\n5. Sending transaction...");
  const tx = await wallet.sendTransaction({
    to: txReq.to,
    data: txReq.data,
    value: txReq.value || "0x0",
    gasLimit: txReq.gas_limit,
    chainId: txReq.chain_id,
  });

  console.log("\n   TX HASH:", tx.hash);
  console.log("   Explorer:", chain.explorer + tx.hash);
  console.log("   LiFi:", "https://explorer.li.fi/tx/" + tx.hash);

  console.log("\n   Waiting for confirmation...");
  const receipt = await tx.wait();
  console.log("   Status:", receipt.status === 1 ? "SUCCESS" : "REVERTED");
  console.log("   Block:", receipt.blockNumber);
  console.log("   Gas used:", receipt.gasUsed.toString());

  return { hash: tx.hash, status: receipt.status };
}

async function main() {
  const wallet = new ethers.Wallet(pk);
  console.log("Wallet:", wallet.address);

  // Test 1: Avalanche USDC → Gauntlet USDC Prime on Base
  const result1 = await doCrossChainDeposit(
    43114,
    "8453:0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
    2
  );

  // Test 2: Optimism USDC → Steakhouse Prime USDC on Base
  const result2 = await doCrossChainDeposit(
    10,
    "8453:0xBEEFE94c8aD530842bfE7d8B397938fFc1cb83b2",
    2
  );

  console.log("\n\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  if (result1) {
    console.log(`Avalanche → Base: ${result1.status === 1 ? "SUCCESS" : "FAILED"}`);
    console.log(`  TX: https://snowtrace.io/tx/${result1.hash}`);
    console.log(`  LiFi: https://explorer.li.fi/tx/${result1.hash}`);
  }
  if (result2) {
    console.log(`Optimism → Base: ${result2.status === 1 ? "SUCCESS" : "FAILED"}`);
    console.log(`  TX: https://optimistic.etherscan.io/tx/${result2.hash}`);
    console.log(`  LiFi: https://explorer.li.fi/tx/${result2.hash}`);
  }
}

main().catch(console.error);
