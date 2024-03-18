import * as anchor from "@coral-xyz/anchor";
import { Program, BN, EventParser, BorshCoder, AnchorProvider, Provider } from "@coral-xyz/anchor";
import { Aogo, IDL } from "../target/types/aogo";
import { Keypair, PublicKey, Connection, SYSVAR_RENT_PUBKEY, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as spl from "@solana/spl-token";
import { Metadata, PROGRAM_ID as METADATA_PROGRAM_ID } from "@metaplex-foundation/mpl-token-metadata";
import { Metaplex } from "@metaplex-foundation/js";
import { hexToBytes, padLeft } from "web3-utils";
import { ASSOCIATED_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";

export class AogoClient {
    public connection: Connection;
    public program: Program<Aogo>;
    public metaplex: Metaplex;
    public endpoint: string;

    public static programId: string = "FpcnrJntp15VXsF1H2sw1k5d63PMtXHGBiKiUh3pqoqh";

    public static fromEndpoint(endpoint: string) {
        const provider = new AnchorProvider(new Connection(endpoint), null, AnchorProvider.defaultOptions());
        const program = new Program(IDL, new PublicKey(AogoClient.programId), provider);
        return new AogoClient(program);
    }

    constructor(program: Program<Aogo>) {
        this.connection = program["_provider"].connection;
        this.program = program;
        this.metaplex = Metaplex.make(this.connection);
        this.endpoint = this.connection["_rpcEndpoint"];
    }

    findTokenPDA(name: string) {
        return PublicKey.findProgramAddressSync([Buffer.from(name)], this.program.programId)[0];
    }

    findGlobalAccountPDA() {
        return PublicKey.findProgramAddressSync([Buffer.from("Global")], this.program.programId)[0];
    }

    findValultAccountPDA(mint: PublicKey) {
        return PublicKey.findProgramAddressSync([Buffer.from("Vault"), mint.toBuffer()], this.program.programId)[0];
    }

    findUserAccountPDA(user: PublicKey) {
        return PublicKey.findProgramAddressSync([Buffer.from("User"), user.toBuffer()], this.program.programId)[0];
    }

    async queryGlobalAccount() {
        return await this.program.account.globalAccount.fetchNullable(this.findGlobalAccountPDA());
    }

    async queryUserAccount(user: PublicKey) {
        return await this.program.account.userAccount.fetchNullable(this.findUserAccountPDA(user));
    }

    async queryMetadata(pda: PublicKey) {
        const accInfo = await this.connection.getAccountInfo(pda);
        return accInfo && Metadata.deserialize(accInfo.data, 0)[0];
    }

    async queryTokenMetadata(name: string) {
        const tokenMintPDA = this.findTokenPDA(name);
        const metadataPDA = this.metaplex.nfts().pdas().metadata({ mint: tokenMintPDA });
        return await this.queryMetadata(metadataPDA);
    }

    bnToBytes(b: BN) {
        return hexToBytes(padLeft(b.toBuffer().toString("hex"), 8 * 2));
    }

    async createToken(admin: Keypair, name: string, symbol: string, uri: string) {
        const tokenMintPDA = this.findTokenPDA(name);
        const metadataPDA = this.metaplex.nfts().pdas().metadata({ mint: tokenMintPDA });
        const method = this.program.methods.createToken(name, symbol, uri).accounts({
            admin: admin.publicKey,
            globalAccount: this.findGlobalAccountPDA(),
            metadataAccount: metadataPDA,
            tokenMint: tokenMintPDA,
            tokenMetadataProgram: METADATA_PROGRAM_ID,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
            systemProgram: SystemProgram.programId,
        });
        const t = new anchor.web3.Transaction().add(await method.transaction());
        return await anchor.web3.sendAndConfirmTransaction(this.connection, t, [admin], { skipPreflight: true });
    }

    async mintToken(admin: Keypair, tokenName: string, to: PublicKey, amount: BN) {
        const tokenMintPDA = this.findTokenPDA(tokenName);
        let tokenAccount = await spl.getOrCreateAssociatedTokenAccount(this.connection, admin, tokenMintPDA, to);
        const method = this.program.methods.mintToken(tokenName, amount).accounts({
            user: admin.publicKey,
            globalAccount: this.findGlobalAccountPDA(),
            tokenMint: tokenMintPDA,
            tokenAccount: tokenAccount.address,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
        });
        // return method.signers([admin]).rpc();
        const t = new anchor.web3.Transaction().add(await method.transaction());
        return await anchor.web3.sendAndConfirmTransaction(this.connection, t, [admin], { skipPreflight: true });
    }

    async getTokenBalance(tokenAccount: PublicKey) {
        try {
            return (await this.connection.getTokenAccountBalance(tokenAccount)).value;
        } catch (err) {
            return {};
        }
    }

    findMetadataPDA(mint: PublicKey) {
        return this.metaplex.nfts().pdas().metadata({ mint });
    }

    async initialize(admin: Keypair, signer: PublicKey) {
        const method = this.program.methods.initialize(signer).accounts({
            admin: admin.publicKey,
            globalAccount: this.findGlobalAccountPDA(),
            rent: SYSVAR_RENT_PUBKEY,
            systemProgram: SystemProgram.programId,
        });
        // return await method.signers([admin]).rpc();
        const t = new anchor.web3.Transaction().add(await method.transaction());
        return await anchor.web3.sendAndConfirmTransaction(this.connection, t, [admin], { skipPreflight: true });
    }

    async initializeVault(admin: Keypair, mint: PublicKey) {
        const method = this.program.methods.initializeVault().accounts({
            admin: admin.publicKey,
            vaultAccount: this.findValultAccountPDA(mint),
            mint,
            rent: SYSVAR_RENT_PUBKEY,
            systemProgram: SystemProgram.programId,
        });

        // return await method.signers([admin]).rpc();
        const t = new anchor.web3.Transaction().add(await method.transaction());
        return await anchor.web3.sendAndConfirmTransaction(this.connection, t, [admin], { skipPreflight: true });
    }

    async claim(user: Keypair, mint: PublicKey, amount: BN, signer: PublicKey, message: Uint8Array, signature: Uint8Array) {
        const vaultAccount = this.findValultAccountPDA(mint);
        const userTokenAccount = spl.getAssociatedTokenAddressSync(mint, user.publicKey);
        const method = this.program.methods.claim(amount, Array.from(signature)).accounts({
            user: user.publicKey,
            globalAccount: this.findGlobalAccountPDA(),
            vaultAccount,
            userTokenAccount,
            userAccount: this.findUserAccountPDA(user.publicKey),
            tokenMint: mint,
            tokenProgram: TOKEN_PROGRAM_ID,
            ixSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
            associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        });
        // return method.signers([user]).rpc();
        const t = new anchor.web3.Transaction().add(
            anchor.web3.Ed25519Program.createInstructionWithPublicKey({
                publicKey: signer.toBytes(),
                message,
                signature,
            }),
            await method.transaction()
        );
        return await anchor.web3.sendAndConfirmTransaction(this.connection, t, [user], { skipPreflight: true });
    }

    async emergencyWithdraw(admin: Keypair, mint: PublicKey, amount: BN, to: PublicKey) {
        const vaultAccount = this.findValultAccountPDA(mint);
        const userTokenAccount = await spl.getOrCreateAssociatedTokenAccount(this.connection, admin, mint, to);
        const method = this.program.methods.emergencyWithdraw(amount).accounts({
            admin: admin.publicKey,
            globalAccount: this.findGlobalAccountPDA(),
            vaultAccount,
            userTokenAccount: userTokenAccount.address,
            tokenMint: mint,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        });
        // return method.signers([user]).rpc();
        const t = new anchor.web3.Transaction().add(await method.transaction());
        return await anchor.web3.sendAndConfirmTransaction(this.connection, t, [admin], { skipPreflight: true });
    }
}
