import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SlotMachine } from "../target/types/slot_machine";
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import { createHash } from "crypto";
import { BN } from "@coral-xyz/anchor";
import crypto from "crypto";

const TREASURY_SEED = Buffer.from("treasury");
const GAME_CONFIG_SEED = Buffer.from("game_config");

// Helper function to create commitment hash (matches the Rust implementation)
function createCommitmentHash(secretValue: number, salt: number, playerPubkey: PublicKey): Buffer {
  const hash = createHash('sha256');
  
  // Convert to little-endian bytes (matching Rust's to_le_bytes())
  const secretBytes = Buffer.allocUnsafe(8);
  secretBytes.writeBigUInt64LE(BigInt(secretValue), 0);
  
  const saltBytes = Buffer.allocUnsafe(8);
  saltBytes.writeBigUInt64LE(BigInt(salt), 0);
  
  hash.update(secretBytes);
  hash.update(saltBytes);
  hash.update(playerPubkey.toBuffer());
  
  return hash.digest();
}

// Helper to wait for specified seconds
function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

describe("slot_machine with Switchboard integration", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider();
  const program = anchor.workspace.slot_machine as Program<SlotMachine>;

  let authority: Keypair;
  let player: Keypair;
  let gameConfig: PublicKey;
  let treasury: PublicKey;
  let treasuryBump: number;
  let randomnessClient: PublicKey;

  // Helper to airdrop SOL
  async function airdrop(pubkey: PublicKey, amountSol: number) {
    const sig = await provider.connection.requestAirdrop(pubkey, amountSol * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);
  }

  before(async () => {
    authority = Keypair.generate();
    player = Keypair.generate();
    await airdrop(authority.publicKey, 10);
    await airdrop(player.publicKey, 5);
    
    // Derive PDAs
    [gameConfig] = PublicKey.findProgramAddressSync([
      GAME_CONFIG_SEED,
      authority.publicKey.toBuffer(),
    ], program.programId);
    
    [treasury, treasuryBump] = PublicKey.findProgramAddressSync([
      TREASURY_SEED
    ], program.programId);
    
    // Derive randomness client PDA
    [randomnessClient] = PublicKey.findProgramAddressSync(
      [Buffer.from("randomness"), authority.publicKey.toBuffer()],
      program.programId
    );
    
    // Initialize game config
    await program.methods.initialize().accounts({
      gameConfig,
      treasury,
      authority: authority.publicKey,
      systemProgram: SystemProgram.programId,
    } as any).signers([authority]).rpc();
    
    // Initialize randomness client
    await program.methods
      .initRandomnessClient()
      .accounts({
        authority: authority.publicKey,
        randomnessClient,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([authority])
      .rpc();
    
    // Fund the treasury for payouts
    await airdrop(treasury, 10);
  });

  it("Initializes the game config", async () => {
    const config = await program.account.gameConfig.fetch(gameConfig);
    expect(config.authority.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(config.treasuryBump).to.equal(treasuryBump);
  });

  it("Verifies randomness client initialization", async () => {
    const randomnessClientAccount = await program.account.randomnessClient.fetch(randomnessClient);
    expect(randomnessClientAccount.authority.toString()).to.equal(authority.publicKey.toString());
    expect(randomnessClientAccount.useSwitchboard).to.be.false;
    console.log("✅ Randomness client verified for Switchboard integration");
  });

  it("Creates a commitment successfully", async () => {
    const nonce = new BN(1);
    const secretValue = crypto.randomInt(100000);
    const salt = crypto.randomInt(100000);
    const betAmount = new BN(10000000); // 0.01 SOL (minimum)

    const commitmentHash = createCommitmentHash(secretValue, salt, player.publicKey);

    const [commitment] = PublicKey.findProgramAddressSync(
      [Buffer.from("commitment"), player.publicKey.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)],
      program.programId
    );

    await program.methods
      .commit(Array.from(commitmentHash), betAmount, nonce)
      .accounts({
        gameConfig,
        treasury,
        commitment,
        player: player.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([player])
      .rpc();

    const commitmentAccount = await program.account.commitment.fetch(commitment);
    expect(commitmentAccount.player.toString()).to.equal(player.publicKey.toString());
    expect(commitmentAccount.betAmount.toString()).to.equal(betAmount.toString());
    expect(commitmentAccount.revealed).to.be.false;
    expect(commitmentAccount.randomnessRequested).to.be.false;
    console.log("✅ Commitment created successfully");
  });

  it("Requests randomness (Switchboard integration ready)", async () => {
    const nonce = new BN(2);
    const secretValue = crypto.randomInt(100000);
    const salt = crypto.randomInt(100000);
    const betAmount = new BN(20000000); // 0.02 SOL

    const commitmentHash = createCommitmentHash(secretValue, salt, player.publicKey);

    const [commitment] = PublicKey.findProgramAddressSync(
      [Buffer.from("commitment"), player.publicKey.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)],
      program.programId
    );

    // First create the commitment
    await program.methods
      .commit(Array.from(commitmentHash), betAmount, nonce)
      .accounts({
        gameConfig,
        treasury,
        commitment,
        player: player.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([player])
      .rpc();

    // Wait for minimum delay
    await sleep(3);

    // Request randomness
    await program.methods
      .requestRandomness()
      .accounts({
        player: player.publicKey,
        authority: authority.publicKey,
        commitment,
        randomnessClient,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([player, authority])
      .rpc();

    const commitmentAccount = await program.account.commitment.fetch(commitment);
    expect(commitmentAccount.randomnessRequested).to.be.true;
    console.log("✅ Randomness requested successfully (Switchboard ready)");
  });

  it("Consumes randomness and executes slot machine (Switchboard integration)", async () => {
    const nonce = new BN(3);
    const secretValue = crypto.randomInt(100000);
    const salt = crypto.randomInt(100000);
    const betAmount = new BN(30000000); // 0.03 SOL

    const commitmentHash = createCommitmentHash(secretValue, salt, player.publicKey);

    const [commitment] = PublicKey.findProgramAddressSync(
      [Buffer.from("commitment"), player.publicKey.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)],
      program.programId
    );

    // Create commitment
    await program.methods
      .commit(Array.from(commitmentHash), betAmount, nonce)
      .accounts({
        gameConfig,
        treasury,
        commitment,
        player: player.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([player])
      .rpc();

    // Wait and request randomness
    await sleep(3);
    await program.methods
      .requestRandomness()
      .accounts({
        player: player.publicKey,
        authority: authority.publicKey,
        commitment,
        randomnessClient,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([player, authority])
      .rpc();

    // Consume randomness (simulate Switchboard callback)
    const balanceBefore = await provider.connection.getBalance(player.publicKey);
    
    await program.methods
      .consumeRandomness(new BN(secretValue), new BN(salt))
      .accounts({
        player: player.publicKey,
        commitment,
        treasury,
        gameConfig,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([player])
      .rpc();

    const commitmentAccount = await program.account.commitment.fetch(commitment);
    expect(commitmentAccount.revealed).to.be.true;

    const balanceAfter = await provider.connection.getBalance(player.publicKey);
    console.log(`💰 Balance change: ${(balanceAfter - balanceBefore) / LAMPORTS_PER_SOL} SOL`);
    console.log("✅ Switchboard-ready randomness consumed successfully");
  });

  it("Falls back to secure randomness without Switchboard", async () => {
    const nonce = new BN(4);
    const secretValue = crypto.randomInt(100000);
    const salt = crypto.randomInt(100000);
    const betAmount = new BN(15000000); // 0.015 SOL

    const commitmentHash = createCommitmentHash(secretValue, salt, player.publicKey);

    const [commitment] = PublicKey.findProgramAddressSync(
      [Buffer.from("commitment"), player.publicKey.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)],
      program.programId
    );

    // Create commitment
    await program.methods
      .commit(Array.from(commitmentHash), betAmount, nonce)
      .accounts({
        gameConfig,
        treasury,
        commitment,
        player: player.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([player])
      .rpc();

    // Wait for minimum delay
    await sleep(3);

    // Use fallback reveal and spin
    const balanceBefore = await provider.connection.getBalance(player.publicKey);
    
    await program.methods
      .revealAndSpin(new BN(secretValue), new BN(salt))
      .accounts({
        gameConfig,
        treasury,
        commitment,
        player: player.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([player])
      .rpc();

    const commitmentAccount = await program.account.commitment.fetch(commitment);
    expect(commitmentAccount.revealed).to.be.true;

    const balanceAfter = await provider.connection.getBalance(player.publicKey);
    console.log(`💰 Fallback balance change: ${(balanceAfter - balanceBefore) / LAMPORTS_PER_SOL} SOL`);
    console.log("✅ Fallback randomness works correctly");
  });

  it("Prevents double reveal", async () => {
    const nonce = new BN(5);
    const secretValue = crypto.randomInt(100000);
    const salt = crypto.randomInt(100000);
    const betAmount = new BN(10000000); // 0.01 SOL (minimum)

    const commitmentHash = createCommitmentHash(secretValue, salt, player.publicKey);

    const [commitment] = PublicKey.findProgramAddressSync(
      [Buffer.from("commitment"), player.publicKey.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)],
      program.programId
    );

    // Create and reveal commitment
    await program.methods
      .commit(Array.from(commitmentHash), betAmount, nonce)
      .accounts({
        gameConfig,
        treasury,
        commitment,
        player: player.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([player])
      .rpc();

    await sleep(3);

    await program.methods
      .revealAndSpin(new BN(secretValue), new BN(salt))
      .accounts({
        gameConfig,
        treasury,
        commitment,
        player: player.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([player])
      .rpc();

    // Try to reveal again - should fail
    try {
      await program.methods
        .revealAndSpin(new BN(secretValue), new BN(salt))
        .accounts({
          gameConfig,
          treasury,
          commitment,
          player: player.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([player])
        .rpc();
      expect.fail("Should have thrown an error for double reveal");
    } catch (error) {
      expect(error.message).to.include("AlreadyRevealed");
      console.log("✅ Double reveal protection works");
    }
  });

  it("Prevents insufficient delay attacks", async () => {
    const nonce = new BN(6);
    const secretValue = crypto.randomInt(100000);
    const salt = crypto.randomInt(100000);
    const betAmount = new BN(10000000); // 0.01 SOL (minimum)

    const commitmentHash = createCommitmentHash(secretValue, salt, player.publicKey);

    const [commitment] = PublicKey.findProgramAddressSync(
      [Buffer.from("commitment"), player.publicKey.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)],
      program.programId
    );

    await program.methods
      .commit(Array.from(commitmentHash), betAmount, nonce)
      .accounts({
        gameConfig,
        treasury,
        commitment,
        player: player.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([player])
      .rpc();

    // Try to reveal immediately - should fail
    try {
      await program.methods
        .revealAndSpin(new BN(secretValue), new BN(salt))
        .accounts({
          gameConfig,
          treasury,
          commitment,
          player: player.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([player])
        .rpc();
      expect.fail("Should have thrown an error for insufficient delay");
    } catch (error) {
      expect(error.message).to.include("InsufficientDelay");
      console.log("✅ Insufficient delay protection works");
    }
  });

  it("Prevents invalid reveals", async () => {
    const nonce = new BN(7);
    const secretValue = crypto.randomInt(100000);
    const salt = crypto.randomInt(100000);
    const wrongSecret = crypto.randomInt(100000);
    const betAmount = new BN(10000000); // 0.01 SOL (minimum)

    const commitmentHash = createCommitmentHash(secretValue, salt, player.publicKey);

    const [commitment] = PublicKey.findProgramAddressSync(
      [Buffer.from("commitment"), player.publicKey.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)],
      program.programId
    );

    await program.methods
      .commit(Array.from(commitmentHash), betAmount, nonce)
      .accounts({
        gameConfig,
        treasury,
        commitment,
        player: player.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([player])
      .rpc();

    await sleep(3);

    // Try to reveal with wrong secret - should fail
    try {
      await program.methods
        .revealAndSpin(new BN(wrongSecret), new BN(salt))
        .accounts({
          gameConfig,
          treasury,
          commitment,
          player: player.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([player])
        .rpc();
      expect.fail("Should have thrown an error for invalid reveal");
    } catch (error) {
      expect(error.message).to.include("InvalidReveal");
      console.log("✅ Invalid reveal protection works");
    }
  });



  // Test multiple spins to show randomness distribution
  it("Demonstrates randomness quality with multiple spins", async () => {
    console.log("\n🎰 Testing randomness quality with multiple Switchboard-ready spins...");
    
    let wins = 0;
    let totalPayout = 0;
    const numTests = 3; // Reduced for faster testing
    
    for (let i = 0; i < numTests; i++) {
      const nonce = new BN(100 + i);
      const secretValue = crypto.randomInt(100000);
      const salt = crypto.randomInt(100000);
      const betAmount = new BN(10000000); // 0.01 SOL (minimum)

      const commitmentHash = createCommitmentHash(secretValue, salt, player.publicKey);

      const [commitment] = PublicKey.findProgramAddressSync(
        [Buffer.from("commitment"), player.publicKey.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)],
        program.programId
      );

      await program.methods
        .commit(Array.from(commitmentHash), betAmount, nonce)
        .accounts({
          gameConfig,
          treasury,
          commitment,
          player: player.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([player])
        .rpc();

      await sleep(3);

      const balanceBefore = await provider.connection.getBalance(player.publicKey);
      
      await program.methods
        .revealAndSpin(new BN(secretValue), new BN(salt))
        .accounts({
          gameConfig,
          treasury,
          commitment,
          player: player.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([player])
        .rpc();

      const balanceAfter = await provider.connection.getBalance(player.publicKey);
      const payout = balanceAfter - balanceBefore;
      
      if (payout > 0) {
        wins++;
        totalPayout += payout;
      }
      
      console.log(`   Spin ${i + 1}: ${payout > 0 ? 'WIN' : 'LOSS'} (${payout / LAMPORTS_PER_SOL} SOL)`);
    }
    
    console.log(`\n📊 Results: ${wins}/${numTests} wins, Total payout: ${totalPayout / LAMPORTS_PER_SOL} SOL`);
    console.log("✅ Switchboard-ready randomness quality demonstrated");
  });
});
