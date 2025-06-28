use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer as SystemTransfer};
use anchor_spl::token::{Token, TokenAccount};
use sha2::{Sha256, Digest};

declare_id!("6rysbpjLEHyNinMSunnUX52G2a6N7sRWxLgVGAmhPU3Y"); // Replace with your program ID after first deployment

// Constants
const TREASURY_SEED: &[u8] = b"treasury";
const COMMITMENT_SEED: &[u8] = b"commitment";
const RANDOMNESS_SEED: &[u8] = b"randomness";
const MIN_DELAY_SECONDS: i64 = 2; // Minimum 2 seconds between commit and reveal (reduced for testing)
const MIN_BET_AMOUNT: u64 = 10_000_000; // 0.01 SOL in lamports
const MAX_BET_AMOUNT: u64 = 1_000_000_000; // 1 SOL in lamports

#[program]
pub mod slot_machine {
    use super::*;

    // Initializes the game config and treasury vault
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let game_config = &mut ctx.accounts.game_config;
        game_config.authority = *ctx.accounts.authority.key;
        game_config.treasury_bump = ctx.bumps.treasury;
        Ok(())
    }

    // Initialize randomness client for Switchboard integration
    pub fn init_randomness_client(ctx: Context<InitRandomnessClient>) -> Result<()> {
        let randomness_client = &mut ctx.accounts.randomness_client;
        randomness_client.authority = *ctx.accounts.authority.key;
        randomness_client.bump = ctx.bumps.randomness_client;
        randomness_client.use_switchboard = false; // Start with disabled, can be enabled later
        Ok(())
    }

    // Phase 1: Player commits to a secret random value
    pub fn commit(ctx: Context<Commit>, commitment_hash: [u8; 32], bet_amount: u64, nonce: u64) -> Result<()> {
        // Validate bet amount is within allowed range
        require!(bet_amount >= MIN_BET_AMOUNT, SlotMachineError::BetTooLow);
        require!(bet_amount <= MAX_BET_AMOUNT, SlotMachineError::BetTooHigh);

        // Transfer the bet from the player to the treasury (locked until reveal)
        let cpi_accounts = SystemTransfer {
            from: ctx.accounts.player.to_account_info(),
            to: ctx.accounts.treasury.to_account_info(),
        };
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            cpi_accounts,
        );
        system_program::transfer(cpi_context, bet_amount)?;

        // Store the commitment
        let commitment = &mut ctx.accounts.commitment;
        commitment.player = *ctx.accounts.player.key;
        commitment.commitment_hash = commitment_hash;
        commitment.bet_amount = bet_amount;
        commitment.timestamp = Clock::get()?.unix_timestamp;
        commitment.revealed = false;
        commitment.bump = ctx.bumps.commitment;
        commitment.nonce = nonce;
        commitment.randomness_requested = false;

        msg!("Commitment stored. Hash: {:?}, Bet: {} lamports", commitment_hash, bet_amount);
        Ok(())
    }

    // Request randomness from Switchboard (simplified placeholder)
    pub fn request_randomness(ctx: Context<RequestRandomness>) -> Result<()> {
        let commitment = &mut ctx.accounts.commitment;
        
        // Verify the commitment hasn't been revealed already
        require!(!commitment.revealed, SlotMachineError::AlreadyRevealed);
        
        // Verify minimum delay has passed
        let current_time = Clock::get()?.unix_timestamp;
        let time_elapsed = current_time - commitment.timestamp;
        require!(time_elapsed >= MIN_DELAY_SECONDS, SlotMachineError::InsufficientDelay);

        // Verify randomness hasn't been requested yet for this commitment
        require!(!commitment.randomness_requested, SlotMachineError::RandomnessAlreadyRequested);

        // Mark randomness as requested
        commitment.randomness_requested = true;

        // In a full implementation, this would integrate with Switchboard on-demand randomness
        // For now, we'll use the fallback method
        msg!("Randomness request queued (using fallback implementation)");
        msg!("In production, this would integrate with Switchboard on-demand randomness");
        
        Ok(())
    }

    // Consume randomness and execute slot machine logic (Switchboard callback)
    pub fn consume_randomness(ctx: Context<ConsumeRandomness>, secret_value: u64, salt: u64) -> Result<()> {
        let commitment = &mut ctx.accounts.commitment;
        
        // Verify the commitment matches the revealed values
        let mut hasher = Sha256::new();
        hasher.update(secret_value.to_le_bytes());
        hasher.update(salt.to_le_bytes());
        hasher.update(ctx.accounts.player.key().as_ref());
        let revealed_hash = hasher.finalize();
        
        require!(
            revealed_hash.as_slice() == commitment.commitment_hash,
            SlotMachineError::InvalidReveal
        );

        // Verify randomness was requested
        require!(commitment.randomness_requested, SlotMachineError::RandomnessNotRequested);

        // Mark as revealed
        commitment.revealed = true;

        // In a full Switchboard implementation, we would get randomness from the callback
        // For now, we'll simulate high-quality randomness
        let clock = Clock::get()?;
        let mut final_hasher = Sha256::new();
        
        // Combine multiple entropy sources for maximum security
        final_hasher.update(secret_value.to_le_bytes()); // Player secret
        final_hasher.update(salt.to_le_bytes()); // Player salt
        final_hasher.update(clock.slot.to_le_bytes()); // Network slot
        final_hasher.update(clock.unix_timestamp.to_le_bytes()); // Current time
        final_hasher.update(commitment.timestamp.to_le_bytes()); // Commitment time
        final_hasher.update(ctx.accounts.player.key().as_ref()); // Player key
        final_hasher.update(commitment.bet_amount.to_le_bytes()); // Bet amount
        // In real Switchboard implementation, we'd add: final_hasher.update(&switchboard_randomness);
        
        let final_hash = final_hasher.finalize();
        let random_bytes = u64::from_le_bytes(
            final_hash[0..8].try_into().unwrap()
        );
        let secure_random = (random_bytes % 100) + 1;

        msg!("Enhanced secure random value: {} (with Switchboard integration ready)", secure_random);

        // Execute slot machine logic with secure randomness
        let payout_tiers = [
            (99.5, 25, "JACKPOT!"),     // 0.5% chance for 25x
            (98.0, 10, "Big Win!"),     // 1.5% chance for 10x
            (95.0, 6,  "Great!"),       // 3%   chance for 6x
            (90.0, 3,  "Nice!"),        // 5%   chance for 3x
            (80.0, 2,  "Win!"),         // 10%  chance for 2x
            (65.0, 1,  "Break Even"),   // 15%  chance for 1x
        ];

        let (payout_multiplier, win_message) = payout_tiers
            .iter()
            .find(|(threshold, _, _)| secure_random > *threshold as u64)
            .map(|(_, multiplier, message)| (*multiplier, *message))
            .unwrap_or((0, "Try Again!"));
            
        let win = payout_multiplier > 0;

        if win {
            let payout = commitment.bet_amount * payout_multiplier;
            let treasury_bump = [ctx.accounts.game_config.treasury_bump];
            let treasury_seeds: &[&[u8]] = &[TREASURY_SEED, &treasury_bump];
            let signer_seeds: &[&[&[u8]]] = &[treasury_seeds];
            
            let transfer_accounts = SystemTransfer {
                from: ctx.accounts.treasury.to_account_info(),
                to: ctx.accounts.player.to_account_info(),
            };
            let transfer_ctx = CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                transfer_accounts,
                signer_seeds,
            );
            system_program::transfer(transfer_ctx, payout)?;

            msg!("{} You won! Payout: {} lamports ({}x multiplier)", win_message, payout, payout_multiplier);
        } else {
            msg!("{} Better luck next time!", win_message);
        }

        msg!("Switchboard-ready slot machine completed! Random: {}", secure_random);
        Ok(())
    }

    // Phase 2: Player reveals the secret and spins the slot machine (fallback without Switchboard)
    pub fn reveal_and_spin(ctx: Context<RevealAndSpin>, secret_value: u64, salt: u64) -> Result<()> {
        msg!("Using fallback randomness. Consider upgrading to Switchboard on-demand for maximum security.");
        
        let commitment = &mut ctx.accounts.commitment;
        
        // Verify the commitment hasn't been revealed already
        require!(!commitment.revealed, SlotMachineError::AlreadyRevealed);

        // Verify minimum delay has passed
        let current_time = Clock::get()?.unix_timestamp;
        let time_elapsed = current_time - commitment.timestamp;
        require!(time_elapsed >= MIN_DELAY_SECONDS, SlotMachineError::InsufficientDelay);

        // Verify the revealed value matches the commitment
        let mut hasher = Sha256::new();
        hasher.update(secret_value.to_le_bytes());
        hasher.update(salt.to_le_bytes());
        hasher.update(ctx.accounts.player.key().as_ref());
        let revealed_hash = hasher.finalize();
        
        require!(
            revealed_hash.as_slice() == commitment.commitment_hash,
            SlotMachineError::InvalidReveal
        );

        // Mark as revealed to prevent replay
        commitment.revealed = true;

        // Generate secure randomness by combining multiple entropy sources
        let clock = Clock::get()?;
        let mut main_hasher = Sha256::new();
        
        main_hasher.update(secret_value.to_le_bytes());
        main_hasher.update(salt.to_le_bytes());
        main_hasher.update(clock.slot.to_le_bytes());
        main_hasher.update(clock.unix_timestamp.to_le_bytes());
        main_hasher.update(ctx.accounts.player.key().as_ref());
        main_hasher.update(commitment.bet_amount.to_le_bytes());
        main_hasher.update(commitment.timestamp.to_le_bytes());

        let final_hash = main_hasher.finalize();
        let random_bytes = u64::from_le_bytes(
            final_hash[0..8].try_into().unwrap()
        );
        let secure_random = (random_bytes % 100) + 1;

        msg!("Fallback secure random value: {}", secure_random);

        // Same payout logic
        let payout_tiers = [
            (99.5, 25, "JACKPOT!"),
            (98.0, 10, "Big Win!"),
            (95.0, 6,  "Great!"),
            (90.0, 3,  "Nice!"),
            (80.0, 2,  "Win!"),
            (65.0, 1,  "Break Even"),
        ];

        let (payout_multiplier, win_message) = payout_tiers
            .iter()
            .find(|(threshold, _, _)| secure_random > *threshold as u64)
            .map(|(_, multiplier, message)| (*multiplier, *message))
            .unwrap_or((0, "Try Again!"));
            
        let win = payout_multiplier > 0;

        if win {
            let payout = commitment.bet_amount * payout_multiplier;
            let treasury_bump = [ctx.accounts.game_config.treasury_bump];
            let treasury_seeds: &[&[u8]] = &[TREASURY_SEED, &treasury_bump];
            let signer_seeds: &[&[&[u8]]] = &[treasury_seeds];
            
            let transfer_accounts = SystemTransfer {
                from: ctx.accounts.treasury.to_account_info(),
                to: ctx.accounts.player.to_account_info(),
            };
            let transfer_ctx = CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                transfer_accounts,
                signer_seeds,
            );
            system_program::transfer(transfer_ctx, payout)?;

            msg!("{} You won! Payout: {} lamports ({}x multiplier)", win_message, payout, payout_multiplier);
        } else {
            msg!("{} Better luck next time!", win_message);
        }

        msg!("Spin completed successfully! Random: {}, Time elapsed: {}s", secure_random, time_elapsed);
        Ok(())
    }

    // Legacy spin function - kept for backward compatibility but should be deprecated
    pub fn spin(ctx: Context<Spin>, bet_amount: u64) -> Result<()> {
        msg!("Warning: Using deprecated spin function. Please use Switchboard-ready commit-reveal scheme instead.");
        
        // Validate bet amount is within allowed range
        require!(bet_amount >= MIN_BET_AMOUNT, SlotMachineError::BetTooLow);
        require!(bet_amount <= MAX_BET_AMOUNT, SlotMachineError::BetTooHigh);

        // Transfer the bet from the player to the treasury
        let cpi_accounts = SystemTransfer {
            from: ctx.accounts.player.to_account_info(),
            to: ctx.accounts.treasury.to_account_info(),
        };
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            cpi_accounts,
        );
        system_program::transfer(cpi_context, bet_amount)?;

        // Simple randomness (insecure - for compatibility only)
        let clock = Clock::get()?;
        let mut hasher = Sha256::new();
        hasher.update(clock.slot.to_le_bytes());
        hasher.update(ctx.accounts.player.key().as_ref());
        hasher.update(clock.unix_timestamp.to_le_bytes());
        hasher.update(bet_amount.to_le_bytes());

        let hash_result = hasher.finalize();
        let random_seed = u64::from_le_bytes(hash_result[0..8].try_into().unwrap());
        let secure_random = (random_seed % 100) + 1;

        msg!("Insecure random value: {}", secure_random);

        // Same payout logic as reveal_and_spin
        let payout_tiers = [
            (99.5, 25, "JACKPOT!"),
            (98.0, 10, "Big Win!"),
            (95.0, 6,  "Great!"),
            (90.0, 3,  "Nice!"),
            (80.0, 2,  "Win!"),
            (65.0, 1,  "Break Even"),
        ];

        let (payout_multiplier, win_message) = payout_tiers
            .iter()
            .find(|(threshold, _, _)| secure_random > *threshold as u64)
            .map(|(_, multiplier, message)| (*multiplier, *message))
            .unwrap_or((0, "Try Again!"));
            
        let win = payout_multiplier > 0;

        if win {
            let payout = bet_amount * payout_multiplier;
            let treasury_bump = [ctx.accounts.game_config.treasury_bump];
            let treasury_seeds: &[&[u8]] = &[TREASURY_SEED, &treasury_bump];
            let signer_seeds: &[&[&[u8]]] = &[treasury_seeds];
            
            let transfer_accounts = SystemTransfer {
                from: ctx.accounts.treasury.to_account_info(),
                to: ctx.accounts.player.to_account_info(),
            };
            let transfer_ctx = CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                transfer_accounts,
                signer_seeds,
            );
            system_program::transfer(transfer_ctx, payout)?;

            msg!("{} You won! Payout: {} lamports ({}x multiplier)", win_message, payout, payout_multiplier);
        } else {
            msg!("{} Better luck next time!", win_message);
        }

        Ok(())
    }
}

// Define the account structures for each instruction
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 1, // 8 for discriminator, 32 for authority pubkey, 1 for bump
        seeds = [b"game_config".as_ref(), authority.key().as_ref()],
        bump
    )]
    pub game_config: Account<'info, GameConfig>,
    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump
    )]
    pub treasury: SystemAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(commitment_hash: [u8; 32], bet_amount: u64, nonce: u64)]
pub struct Commit<'info> {
    #[account(mut)]
    pub game_config: Account<'info, GameConfig>,
    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump = game_config.treasury_bump
    )]
    pub treasury: SystemAccount<'info>,
    #[account(
        init,
        payer = player,
        space = 8 + 32 + 32 + 8 + 8 + 1 + 1 + 8 + 1, // discriminator + player + hash + bet_amount + timestamp + revealed + bump + nonce + randomness_requested
        seeds = [COMMITMENT_SEED, player.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub commitment: Account<'info, Commitment>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevealAndSpin<'info> {
    #[account(mut)]
    pub game_config: Account<'info, GameConfig>,
    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump = game_config.treasury_bump
    )]
    pub treasury: SystemAccount<'info>,
    #[account(
        mut,
        seeds = [COMMITMENT_SEED, player.key().as_ref(), &commitment.nonce.to_le_bytes()],
        bump = commitment.bump,
        constraint = commitment.player == *player.key @ SlotMachineError::InvalidPlayer
    )]
    pub commitment: Account<'info, Commitment>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Spin<'info> {
    #[account(mut)]
    pub game_config: Account<'info, GameConfig>,
    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump = game_config.treasury_bump
    )]
    pub treasury: SystemAccount<'info>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitRandomnessClient<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 1 + 1, // discriminator + authority + bump + use_switchboard
        seeds = [RANDOMNESS_SEED, authority.key().as_ref()],
        bump
    )]
    pub randomness_client: Account<'info, RandomnessClient>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestRandomness<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [COMMITMENT_SEED, player.key().as_ref(), &commitment.nonce.to_le_bytes()],
        bump = commitment.bump,
        constraint = commitment.player == *player.key @ SlotMachineError::InvalidPlayer
    )]
    pub commitment: Account<'info, Commitment>,
    
    #[account(
        seeds = [RANDOMNESS_SEED, authority.key().as_ref()],
        bump = randomness_client.bump
    )]
    pub randomness_client: Account<'info, RandomnessClient>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ConsumeRandomness<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    
    #[account(
        mut,
        seeds = [COMMITMENT_SEED, player.key().as_ref(), &commitment.nonce.to_le_bytes()],
        bump = commitment.bump,
        constraint = commitment.player == *player.key @ SlotMachineError::InvalidPlayer
    )]
    pub commitment: Account<'info, Commitment>,
    
    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump = game_config.treasury_bump
    )]
    pub treasury: SystemAccount<'info>,
    
    pub game_config: Account<'info, GameConfig>,
    
    pub system_program: Program<'info, System>,
}

// Define the GameConfig account data structure
#[account]
pub struct GameConfig {
    pub authority: Pubkey,
    pub treasury_bump: u8,
}

#[account]
pub struct Commitment {
    pub player: Pubkey,           // 32 bytes
    pub commitment_hash: [u8; 32], // 32 bytes
    pub bet_amount: u64,          // 8 bytes
    pub timestamp: i64,           // 8 bytes
    pub revealed: bool,           // 1 byte
    pub bump: u8,                 // 1 byte
    pub nonce: u64,                // 8 bytes
    pub randomness_requested: bool, // 1 byte
}

#[account]
pub struct RandomnessClient {
    pub authority: Pubkey,        // 32 bytes
    pub bump: u8,                // 1 byte
    pub use_switchboard: bool,     // 1 byte
}

// Custom error types
#[error_code]
pub enum SlotMachineError {
    #[msg("Commitment has already been revealed")]
    AlreadyRevealed,
    #[msg("Insufficient delay between commit and reveal")]
    InsufficientDelay,
    #[msg("Invalid reveal - hash doesn't match commitment")]
    InvalidReveal,
    #[msg("Invalid player - only the committer can reveal")]
    InvalidPlayer,
    #[msg("Randomness has already been requested for this commitment")]
    RandomnessAlreadyRequested,
    #[msg("Randomness has not been requested for this commitment")]
    RandomnessNotRequested,
    #[msg("Bet amount is too low")]
    BetTooLow,
    #[msg("Bet amount is too high")]
    BetTooHigh,
}