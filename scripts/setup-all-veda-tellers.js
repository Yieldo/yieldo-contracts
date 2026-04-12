const hre = require("hardhat");

const ROUTER = "0x85f76c1685046Ea226E1148EE1ab81a8a15C385d";

const TELLERS = [
  { name: "Veda Liquid ETH",  vault: "0xf0bb20865277aBd641a307eCe5Ee04E79073416C", teller: "0x9AA79C84b79816ab920bBcE20f8f74557B514734" },
  { name: "Veda Lombard",     vault: "0x5401b8620E5FB570064CA9114fd1e135fd77D57c", teller: "0x4E8f5128F473C6948127f9Cbca474a6700F99bab" },
  { name: "Veda Liquid BTC",  vault: "0x5f46d540b6eD704C3c8789105F30E075AA900726", teller: "0x8Ea0B382D054dbEBeB1d0aE47ee4AC433C730353" },
  { name: "Veda PlasmaUSD",   vault: "0xd1074E0AE85610dDBA0147e29eBe0D8E5873a000", teller: "0x4E7d2186eB8B75fBDcA867761636637E05BaeF1E" },
  { name: "Veda Liquid USD",  vault: "0x08c6F91e2B681FaF5e17227F2a44C307b3C1364C", teller: "0x4DE413a26fC24c3FC27Cc983be70aA9c5C299387" },
];

async function main() {
  const router = await hre.ethers.getContractAt("DepositRouter", ROUTER);
  console.log("Router:", ROUTER);
  console.log("Owner:", await router.owner());
  console.log();

  for (const { name, vault, teller } of TELLERS) {
    const current = await router.vedaTellers(vault);
    if (current === "0x0000000000000000000000000000000000000000") {
      console.log(`Setting teller for ${name}...`);
      console.log(`  Vault:  ${vault}`);
      console.log(`  Teller: ${teller}`);
      const tx = await router.setVedaTeller(vault, teller);
      await tx.wait();
      console.log(`  Done! TX: ${tx.hash}`);
    } else if (current.toLowerCase() === teller.toLowerCase()) {
      console.log(`${name}: already set correctly (${current})`);
    } else {
      console.log(`${name}: WARNING - set to different teller: ${current}`);
      console.log(`  Expected: ${teller}`);
    }
  }

  console.log("\nAll tellers configured!");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
