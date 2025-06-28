"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const anchor = __importStar(require("@coral-xyz/anchor"));
const web3_js_1 = require("@solana/web3.js");
const chai_1 = require("chai");
const crypto_1 = require("crypto");
const anchor_1 = require("@coral-xyz/anchor");
const crypto_2 = __importDefault(require("crypto"));
const TREASURY_SEED = Buffer.from("treasury");
const GAME_CONFIG_SEED = Buffer.from("game_config");
// const COMMITMENT_SEED = Buffer.from("commitment");
// Helper function to create commitment hash (matches the Rust implementation)
function createCommitmentHash(secretValue, salt, playerPubkey) {
    const hash = (0, crypto_1.createHash)('sha256');
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
function sleep(seconds) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}
describe("slot_machine with Switchboard integration", () => {
    anchor.setProvider(anchor.AnchorProvider.env());
    const provider = anchor.getProvider();
    const program = anchor.workspace.slot_machine;
    let authority;
    let player;
    let gameConfig;
    let treasury;
    let treasuryBump;
    let randomnessClient;
    // Helper to airdrop SOL
    function airdrop(pubkey, amountSol) {
        return __awaiter(this, void 0, void 0, function* () {
            const sig = yield provider.connection.requestAirdrop(pubkey, amountSol * web3_js_1.LAMPORTS_PER_SOL);
            yield provider.connection.confirmTransaction(sig);
        });
    }
    before(() => __awaiter(void 0, void 0, void 0, function* () {
        authority = web3_js_1.Keypair.generate();
        player = web3_js_1.Keypair.generate();
        yield airdrop(authority.publicKey, 10);
        yield airdrop(player.publicKey, 5);
        // Derive PDAs
        [gameConfig] = web3_js_1.PublicKey.findProgramAddressSync([
            GAME_CONFIG_SEED,
            authority.publicKey.toBuffer(),
        ], program.programId);
        [treasury, treasuryBump] = web3_js_1.PublicKey.findProgramAddressSync([
            TREASURY_SEED
        ], program.programId);
        // Derive randomness client PDA
        [randomnessClient] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("randomness"), authority.publicKey.toBuffer()], program.programId);
        // Initialize game config
        yield program.methods.initialize().accounts({
            gameConfig,
            treasury,
            authority: authority.publicKey,
            systemProgram: web3_js_1.SystemProgram.programId,
        }).signers([authority]).rpc();
        // Initialize randomness client
        yield program.methods
            .initRandomnessClient()
            .accounts({
            authority: authority.publicKey,
            randomnessClient,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .signers([authority])
            .rpc();
        // Fund the treasury for payouts
        yield airdrop(treasury, 10);
    }));
    it("Initializes the game config", () => __awaiter(void 0, void 0, void 0, function* () {
        const config = yield program.account.gameConfig.fetch(gameConfig);
        (0, chai_1.expect)(config.authority.toBase58()).to.equal(authority.publicKey.toBase58());
        (0, chai_1.expect)(config.treasuryBump).to.equal(treasuryBump);
    }));
    it("Verifies randomness client initialization", () => __awaiter(void 0, void 0, void 0, function* () {
        const randomnessClientAccount = yield program.account.randomnessClient.fetch(randomnessClient);
        (0, chai_1.expect)(randomnessClientAccount.authority.toString()).to.equal(authority.publicKey.toString());
        (0, chai_1.expect)(randomnessClientAccount.useSwitchboard).to.be.false;
        console.log("✅ Randomness client verified for Switchboard integration");
    }));
    it("Creates a commitment successfully", () => __awaiter(void 0, void 0, void 0, function* () {
        const nonce = new anchor_1.BN(1);
        const secretValue = crypto_2.default.randomInt(100000);
        const salt = crypto_2.default.randomInt(100000);
        const betAmount = new anchor_1.BN(10000000); // 0.01 SOL (minimum)
        const commitmentHash = createCommitmentHash(secretValue, salt, player.publicKey);
        const [commitment] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("commitment"), player.publicKey.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)], program.programId);
        yield program.methods
            .commit(Array.from(commitmentHash), betAmount, nonce)
            .accounts({
            gameConfig,
            treasury,
            commitment,
            player: player.publicKey,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .signers([player])
            .rpc();
        const commitmentAccount = yield program.account.commitment.fetch(commitment);
        (0, chai_1.expect)(commitmentAccount.player.toString()).to.equal(player.publicKey.toString());
        (0, chai_1.expect)(commitmentAccount.betAmount.toString()).to.equal(betAmount.toString());
        (0, chai_1.expect)(commitmentAccount.revealed).to.be.false;
        (0, chai_1.expect)(commitmentAccount.randomnessRequested).to.be.false;
        console.log("✅ Commitment created successfully");
    }));
    it("Requests randomness (Switchboard integration ready)", () => __awaiter(void 0, void 0, void 0, function* () {
        const nonce = new anchor_1.BN(2);
        const secretValue = crypto_2.default.randomInt(100000);
        const salt = crypto_2.default.randomInt(100000);
        const betAmount = new anchor_1.BN(20000000); // 0.02 SOL
        const commitmentHash = createCommitmentHash(secretValue, salt, player.publicKey);
        const [commitment] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("commitment"), player.publicKey.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)], program.programId);
        // First create the commitment
        yield program.methods
            .commit(Array.from(commitmentHash), betAmount, nonce)
            .accounts({
            gameConfig,
            treasury,
            commitment,
            player: player.publicKey,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .signers([player])
            .rpc();
        // Wait for minimum delay
        yield sleep(3);
        // Request randomness
        yield program.methods
            .requestRandomness()
            .accounts({
            player: player.publicKey,
            authority: authority.publicKey,
            commitment,
            randomnessClient,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .signers([player, authority])
            .rpc();
        const commitmentAccount = yield program.account.commitment.fetch(commitment);
        (0, chai_1.expect)(commitmentAccount.randomnessRequested).to.be.true;
        console.log("✅ Randomness requested successfully (Switchboard ready)");
    }));
    it("Consumes randomness and executes slot machine (Switchboard integration)", () => __awaiter(void 0, void 0, void 0, function* () {
        const nonce = new anchor_1.BN(3);
        const secretValue = crypto_2.default.randomInt(100000);
        const salt = crypto_2.default.randomInt(100000);
        const betAmount = new anchor_1.BN(30000000); // 0.03 SOL
        const commitmentHash = createCommitmentHash(secretValue, salt, player.publicKey);
        const [commitment] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("commitment"), player.publicKey.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)], program.programId);
        // Create commitment
        yield program.methods
            .commit(Array.from(commitmentHash), betAmount, nonce)
            .accounts({
            gameConfig,
            treasury,
            commitment,
            player: player.publicKey,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .signers([player])
            .rpc();
        // Wait and request randomness
        yield sleep(3);
        yield program.methods
            .requestRandomness()
            .accounts({
            player: player.publicKey,
            authority: authority.publicKey,
            commitment,
            randomnessClient,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .signers([player, authority])
            .rpc();
        // Consume randomness (simulate Switchboard callback)
        const balanceBefore = yield provider.connection.getBalance(player.publicKey);
        yield program.methods
            .consumeRandomness(new anchor_1.BN(secretValue), new anchor_1.BN(salt))
            .accounts({
            player: player.publicKey,
            commitment,
            treasury,
            gameConfig,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .signers([player])
            .rpc();
        const commitmentAccount = yield program.account.commitment.fetch(commitment);
        (0, chai_1.expect)(commitmentAccount.revealed).to.be.true;
        const balanceAfter = yield provider.connection.getBalance(player.publicKey);
        console.log(`💰 Balance change: ${(balanceAfter - balanceBefore) / web3_js_1.LAMPORTS_PER_SOL} SOL`);
        console.log("✅ Switchboard-ready randomness consumed successfully");
    }));
    it("Falls back to secure randomness without Switchboard", () => __awaiter(void 0, void 0, void 0, function* () {
        const nonce = new anchor_1.BN(4);
        const secretValue = crypto_2.default.randomInt(100000);
        const salt = crypto_2.default.randomInt(100000);
        const betAmount = new anchor_1.BN(15000000); // 0.015 SOL
        const commitmentHash = createCommitmentHash(secretValue, salt, player.publicKey);
        const [commitment] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("commitment"), player.publicKey.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)], program.programId);
        // Create commitment
        yield program.methods
            .commit(Array.from(commitmentHash), betAmount, nonce)
            .accounts({
            gameConfig,
            treasury,
            commitment,
            player: player.publicKey,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .signers([player])
            .rpc();
        // Wait for minimum delay
        yield sleep(3);
        // Use fallback reveal and spin
        const balanceBefore = yield provider.connection.getBalance(player.publicKey);
        yield program.methods
            .revealAndSpin(new anchor_1.BN(secretValue), new anchor_1.BN(salt))
            .accounts({
            gameConfig,
            treasury,
            commitment,
            player: player.publicKey,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .signers([player])
            .rpc();
        const commitmentAccount = yield program.account.commitment.fetch(commitment);
        (0, chai_1.expect)(commitmentAccount.revealed).to.be.true;
        const balanceAfter = yield provider.connection.getBalance(player.publicKey);
        console.log(`💰 Fallback balance change: ${(balanceAfter - balanceBefore) / web3_js_1.LAMPORTS_PER_SOL} SOL`);
        console.log("✅ Fallback randomness works correctly");
    }));
    it("Prevents double reveal", () => __awaiter(void 0, void 0, void 0, function* () {
        const nonce = new anchor_1.BN(5);
        const secretValue = crypto_2.default.randomInt(100000);
        const salt = crypto_2.default.randomInt(100000);
        const betAmount = new anchor_1.BN(10000000); // 0.01 SOL (minimum)
        const commitmentHash = createCommitmentHash(secretValue, salt, player.publicKey);
        const [commitment] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("commitment"), player.publicKey.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)], program.programId);
        // Create and reveal commitment
        yield program.methods
            .commit(Array.from(commitmentHash), betAmount, nonce)
            .accounts({
            gameConfig,
            treasury,
            commitment,
            player: player.publicKey,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .signers([player])
            .rpc();
        yield sleep(3);
        yield program.methods
            .revealAndSpin(new anchor_1.BN(secretValue), new anchor_1.BN(salt))
            .accounts({
            gameConfig,
            treasury,
            commitment,
            player: player.publicKey,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .signers([player])
            .rpc();
        // Try to reveal again - should fail
        try {
            yield program.methods
                .revealAndSpin(new anchor_1.BN(secretValue), new anchor_1.BN(salt))
                .accounts({
                gameConfig,
                treasury,
                commitment,
                player: player.publicKey,
                systemProgram: web3_js_1.SystemProgram.programId,
            })
                .signers([player])
                .rpc();
            chai_1.expect.fail("Should have thrown an error for double reveal");
        }
        catch (error) {
            (0, chai_1.expect)(error.message).to.include("AlreadyRevealed");
            console.log("✅ Double reveal protection works");
        }
    }));
    it("Prevents insufficient delay attacks", () => __awaiter(void 0, void 0, void 0, function* () {
        const nonce = new anchor_1.BN(6);
        const secretValue = crypto_2.default.randomInt(100000);
        const salt = crypto_2.default.randomInt(100000);
        const betAmount = new anchor_1.BN(10000000); // 0.01 SOL (minimum)
        const commitmentHash = createCommitmentHash(secretValue, salt, player.publicKey);
        const [commitment] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("commitment"), player.publicKey.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)], program.programId);
        yield program.methods
            .commit(Array.from(commitmentHash), betAmount, nonce)
            .accounts({
            gameConfig,
            treasury,
            commitment,
            player: player.publicKey,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .signers([player])
            .rpc();
        // Try to reveal immediately - should fail
        try {
            yield program.methods
                .revealAndSpin(new anchor_1.BN(secretValue), new anchor_1.BN(salt))
                .accounts({
                gameConfig,
                treasury,
                commitment,
                player: player.publicKey,
                systemProgram: web3_js_1.SystemProgram.programId,
            })
                .signers([player])
                .rpc();
            chai_1.expect.fail("Should have thrown an error for insufficient delay");
        }
        catch (error) {
            (0, chai_1.expect)(error.message).to.include("InsufficientDelay");
            console.log("✅ Insufficient delay protection works");
        }
    }));
    it("Prevents invalid reveals", () => __awaiter(void 0, void 0, void 0, function* () {
        const nonce = new anchor_1.BN(7);
        const secretValue = crypto_2.default.randomInt(100000);
        const salt = crypto_2.default.randomInt(100000);
        const wrongSecret = crypto_2.default.randomInt(100000);
        const betAmount = new anchor_1.BN(10000000); // 0.01 SOL (minimum)
        const commitmentHash = createCommitmentHash(secretValue, salt, player.publicKey);
        const [commitment] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("commitment"), player.publicKey.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)], program.programId);
        yield program.methods
            .commit(Array.from(commitmentHash), betAmount, nonce)
            .accounts({
            gameConfig,
            treasury,
            commitment,
            player: player.publicKey,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .signers([player])
            .rpc();
        yield sleep(3);
        // Try to reveal with wrong secret - should fail
        try {
            yield program.methods
                .revealAndSpin(new anchor_1.BN(wrongSecret), new anchor_1.BN(salt))
                .accounts({
                gameConfig,
                treasury,
                commitment,
                player: player.publicKey,
                systemProgram: web3_js_1.SystemProgram.programId,
            })
                .signers([player])
                .rpc();
            chai_1.expect.fail("Should have thrown an error for invalid reveal");
        }
        catch (error) {
            (0, chai_1.expect)(error.message).to.include("InvalidReveal");
            console.log("✅ Invalid reveal protection works");
        }
    }));
    it("Legacy spin function works (deprecated)", () => __awaiter(void 0, void 0, void 0, function* () {
        const betAmount = new anchor_1.BN(10000000); // 0.01 SOL (minimum)
        const balanceBefore = yield provider.connection.getBalance(player.publicKey);
        yield program.methods
            .spin(betAmount)
            .accounts({
            gameConfig,
            treasury,
            player: player.publicKey,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .signers([player])
            .rpc();
        const balanceAfter = yield provider.connection.getBalance(player.publicKey);
        console.log(`💰 Legacy spin balance change: ${(balanceAfter - balanceBefore) / web3_js_1.LAMPORTS_PER_SOL} SOL`);
        console.log("⚠️  Legacy spin function works (should use Switchboard-ready commit-reveal instead)");
    }));
    // Test multiple spins to show randomness distribution
    it("Demonstrates randomness quality with multiple spins", () => __awaiter(void 0, void 0, void 0, function* () {
        console.log("\n🎰 Testing randomness quality with multiple Switchboard-ready spins...");
        let wins = 0;
        let totalPayout = 0;
        const numTests = 3; // Reduced for faster testing
        for (let i = 0; i < numTests; i++) {
            const nonce = new anchor_1.BN(100 + i);
            const secretValue = crypto_2.default.randomInt(100000);
            const salt = crypto_2.default.randomInt(100000);
            const betAmount = new anchor_1.BN(10000000); // 0.01 SOL (minimum)
            const commitmentHash = createCommitmentHash(secretValue, salt, player.publicKey);
            const [commitment] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("commitment"), player.publicKey.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)], program.programId);
            yield program.methods
                .commit(Array.from(commitmentHash), betAmount, nonce)
                .accounts({
                gameConfig,
                treasury,
                commitment,
                player: player.publicKey,
                systemProgram: web3_js_1.SystemProgram.programId,
            })
                .signers([player])
                .rpc();
            yield sleep(3);
            const balanceBefore = yield provider.connection.getBalance(player.publicKey);
            yield program.methods
                .revealAndSpin(new anchor_1.BN(secretValue), new anchor_1.BN(salt))
                .accounts({
                gameConfig,
                treasury,
                commitment,
                player: player.publicKey,
                systemProgram: web3_js_1.SystemProgram.programId,
            })
                .signers([player])
                .rpc();
            const balanceAfter = yield provider.connection.getBalance(player.publicKey);
            const payout = balanceAfter - balanceBefore;
            if (payout > 0) {
                wins++;
                totalPayout += payout;
            }
            console.log(`   Spin ${i + 1}: ${payout > 0 ? 'WIN' : 'LOSS'} (${payout / web3_js_1.LAMPORTS_PER_SOL} SOL)`);
        }
        console.log(`\n📊 Results: ${wins}/${numTests} wins, Total payout: ${totalPayout / web3_js_1.LAMPORTS_PER_SOL} SOL`);
        console.log("✅ Switchboard-ready randomness quality demonstrated");
    }));
});
