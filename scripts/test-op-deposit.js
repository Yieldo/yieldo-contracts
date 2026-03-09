const { ethers } = require("ethers");
const http = require("http");

const pk = "REDACTED_PRIVATE_KEY";
const API_BASE = "http://localhost:8000";

const ERC20_ABI = [
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
];

function apiCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + path);
    const options = { hostname: url.hostname, port: url.port, path: url.pathname, method, headers: { "Content-Type": "application/json" } };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(data)); } });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  const provider = new ethers.JsonRpcProvider("https://mainnet.optimism.io");
  const wallet = new ethers.Wallet(pk, provider);
  console.log("Wallet:", wallet.address);

  // Step 1: Get fresh quote
  console.log("\n1. Getting fresh quote (Optimism → Base Steakhouse USDC)...");
  const quote = await apiCall("POST", "/v1/quote", {
    from_chain_id: 10,
    from_token: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    from_amount: "2000000",
    vault_id: "8453:0xBEEFE94c8aD530842bfE7d8B397938fFc1cb83b2",
    user_address: wallet.address,
    slippage: 0.03,
  });

  if (quote.detail || quote.error) {
    console.error("Quote error:", JSON.stringify(quote));
    return;
  }

  console.log("   Nonce:", quote.intent.nonce);
  console.log("   Intent amount:", quote.intent.amount);

  // Step 2: Sign
  console.log("\n2. Signing EIP-712...");
  const { domain, types, message } = quote.eip712;
  const sigTypes = { ...types };
  delete sigTypes.EIP712Domain;
  const signature = await wallet.signTypedData(domain, sigTypes, message);
  console.log("   Done");

  // Step 3: Build
  console.log("\n3. Building transaction...");
  const build = await apiCall("POST", "/v1/quote/build", {
    signature,
    nonce: quote.intent.nonce,
    deadline: quote.intent.deadline,
    intent_amount: quote.intent.amount,
    from_chain_id: 10,
    from_token: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    from_amount: "2000000",
    vault_id: "8453:0xBEEFE94c8aD530842bfE7d8B397938fFc1cb83b2",
    user_address: wallet.address,
    slippage: 0.03,
  });

  if (build.detail || build.error) {
    console.error("Build error:", JSON.stringify(build));
    return;
  }

  const txReq = build.transaction_request;

  // Step 4: Approve if needed
  if (build.approval) {
    const usdc = new ethers.Contract(build.approval.token_address, ERC20_ABI, wallet);
    const allowance = await usdc.allowance(wallet.address, build.approval.spender_address);
    if (allowance < BigInt(build.approval.amount)) {
      console.log("\n4. Approving...");
      const tx = await usdc.approve(build.approval.spender_address, BigInt(build.approval.amount) * 10n);
      await tx.wait();
      console.log("   Approved");
    } else {
      console.log("\n4. Already approved");
    }
  }

  // Step 5: Send
  console.log("\n5. Sending transaction...");
  const tx = await wallet.sendTransaction({
    to: txReq.to,
    data: txReq.data,
    value: txReq.value || "0x0",
    gasLimit: txReq.gas_limit,
    chainId: txReq.chain_id,
  });

  console.log("\n   TX HASH:", tx.hash);
  console.log("   Explorer: https://optimistic.etherscan.io/tx/" + tx.hash);
  console.log("   LiFi: https://explorer.li.fi/tx/" + tx.hash);

  const receipt = await tx.wait();
  console.log("\n   Status:", receipt.status === 1 ? "SUCCESS" : "REVERTED");
  console.log("   Gas used:", receipt.gasUsed.toString());
}

main().catch(console.error);
