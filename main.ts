import { AogoClient } from "./sdk/sdk";
import * as bs58 from "bs58";
import { privateKey } from "./key.json";
import { Keypair, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
const axios = require("axios");
import base58 from "bs58";

var client: AogoClient;
var user: Keypair;

const apiDomain = "https://abi.aogo.wtf";

async function main() {
    // client = new AogoClient("https://api.mainnet-beta.solana.com");
    client = AogoClient.fromEndpoint("https://api.devnet.solana.com");
    user = Keypair.fromSecretKey(bs58.decode(privateKey));
    console.log("user", user.publicKey.toBase58());
    await claim();
    await queryClaimLogs();
}

async function claim() {
    const url = `${apiDomain}/api/user/claimParams?address=${user.publicKey.toBase58()}`;
    console.log("url", url);
    let res = await axios.get(url);
    console.log(res.data);
    let { amount, message, signature, signer, mint } = res.data.data;
    const ts = await client.claim(user, new PublicKey(mint), new BN(amount), new PublicKey(signer), base58.decode(message), base58.decode(signature));
    console.log("claim", ts);
}

async function queryClaimLogs() {
    const url = `${apiDomain}/api/user/claimLogs?address=${user.publicKey.toBase58()}`;
    console.log("url", url);
    let res = await axios.get(url);
    console.log(res.data);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
