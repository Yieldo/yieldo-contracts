const hre = require("hardhat");

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;

  if (!contractAddress || !contractAddress.startsWith('0x')) {
    console.error("Set CONTRACT_ADDRESS env var");
    process.exit(1);
  }

  const network = hre.network.name;
  const explorerNames = { mainnet: 'Etherscan', avalanche: 'Snowtrace', arbitrum: 'Arbiscan', base: 'Basescan' };
  const explorerBases = {
    mainnet: 'https://etherscan.io',
    avalanche: 'https://snowtrace.io',
    arbitrum: 'https://arbiscan.io',
    base: 'https://basescan.org',
  };
  const explorerName = explorerNames[network] || 'Explorer';
  const explorerUrl = `${explorerBases[network] || explorerBases.mainnet}/address/${contractAddress}#code`;

  console.log(`Verifying contract at ${contractAddress} on ${explorerName}...`);
  console.log(`Network: ${network}`);

  try {
    // For UUPS proxy: verify implementation with no constructor args
    await hre.run("verify:verify", {
      address: contractAddress,
      constructorArguments: [],
    });
    console.log(`Implementation verified!`);
  } catch (error) {
    if (error.message.includes("Already Verified") || error.message.includes("already verified")) {
      console.log("Contract is already verified!");
    } else if (error.message.includes("Reason: The Etherscan API") || error.message.includes("proxy")) {
      // Try verifying as proxy
      console.log("Trying proxy verification...");
      try {
        await hre.run("verify:verify", {
          address: contractAddress,
          constructorArguments: [],
          contract: "contracts/DepositRouter.sol:DepositRouter",
        });
        console.log("Verified!");
      } catch (e2) {
        if (e2.message.includes("Already Verified") || e2.message.includes("already verified")) {
          console.log("Contract is already verified!");
        } else {
          console.error("Verification failed:", e2.message);
          process.exit(1);
        }
      }
    } else {
      console.error("Verification failed:", error.message);
      process.exit(1);
    }
  }

  console.log(`View on ${explorerName}: ${explorerUrl}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
