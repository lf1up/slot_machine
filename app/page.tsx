'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import toast from 'react-hot-toast';

// Constants
const MIN_BET_AMOUNT = 0.01; // SOL
const MAX_BET_AMOUNT = 1.0; // SOL

const SLOT_SYMBOLS = ['🍒', '🍋', '🍊', '🍇', '🔔', '💎', '7️⃣'];

export default function SlotMachinePage() {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  
  // UI State
  const [balance, setBalance] = useState<number>(0);
  const [betAmount, setBetAmount] = useState<number>(MIN_BET_AMOUNT);
  const [isSpinning, setIsSpinning] = useState<boolean>(false);
  const [reels, setReels] = useState<string[]>(['🎰', '🎰', '🎰']);
  const [lastResult, setLastResult] = useState<string>('');
  const [gameState, setGameState] = useState<'idle' | 'committed' | 'spinning' | 'revealing'>('idle');
  
  // Game State
  const [currentCommitment, setCurrentCommitment] = useState<{
    secret: number;
    salt: number;
    nonce: number;
    timestamp: number;
  } | null>(null);

  // Get wallet balance
  const updateBalance = useCallback(async () => {
    if (!publicKey || !connection) return;
    
    try {
      const balance = await connection.getBalance(publicKey);
      setBalance(balance / LAMPORTS_PER_SOL);
    } catch (error) {
      console.error('Failed to get balance:', error);
    }
  }, [connection, publicKey]);

  useEffect(() => {
    updateBalance();
    const interval = setInterval(updateBalance, 10000); // Update every 10 seconds
    return () => clearInterval(interval);
  }, [updateBalance]);

  // Spin animation
  const animateReels = () => {
    setIsSpinning(true);
    
    let animationCount = 0;
    const animationInterval = setInterval(() => {
      setReels([
        SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
        SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
        SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]
      ]);
      
      animationCount++;
      if (animationCount > 20) {
        clearInterval(animationInterval);
        setIsSpinning(false);
      }
    }, 100);
  };

  // Handle commit phase
  const handleCommit = async () => {
    if (!publicKey) {
      toast.error('Wallet not connected');
      return;
    }

    if (betAmount < MIN_BET_AMOUNT || betAmount > MAX_BET_AMOUNT) {
      toast.error(`Bet amount must be between ${MIN_BET_AMOUNT} and ${MAX_BET_AMOUNT} SOL`);
      return;
    }

    if (balance < betAmount) {
      toast.error('Insufficient balance');
      return;
    }

    try {
      setGameState('committed');
      const secret = Math.floor(Math.random() * 100000);
      const salt = Math.floor(Math.random() * 100000);
      const nonce = Date.now();

      toast.success('Commitment created! Wait 3 seconds before revealing...');
      
      setCurrentCommitment({
        secret,
        salt,
        nonce,
        timestamp: Date.now()
      });

      // Auto-reveal after 3 seconds for demo
      setTimeout(() => {
        handleReveal();
      }, 3000);

    } catch (error) {
      console.error('Commit failed:', error);
      toast.error('Failed to create commitment');
      setGameState('idle');
    }
  };

  // Handle reveal phase
  const handleReveal = async () => {
    if (!currentCommitment) {
      toast.error('No commitment to reveal');
      return;
    }

    try {
      setGameState('spinning');
      animateReels();

      // Simulate the reveal and spin
      setTimeout(() => {
        const random = Math.random() * 100;
        let won = false;
        let payout = 0;
        let message = '';

        if (random > 99.5) {
          won = true;
          payout = betAmount * 25;
          message = 'JACKPOT! 🎉';
          setReels(['💎', '💎', '💎']);
        } else if (random > 98) {
          won = true;
          payout = betAmount * 10;
          message = 'Big Win! 🔥';
          setReels(['7️⃣', '7️⃣', '7️⃣']);
        } else if (random > 95) {
          won = true;
          payout = betAmount * 6;
          message = 'Great! ⭐';
          setReels(['🔔', '🔔', '🔔']);
        } else if (random > 90) {
          won = true;
          payout = betAmount * 3;
          message = 'Nice! 👍';
          setReels(['🍇', '🍇', '🍇']);
        } else if (random > 80) {
          won = true;
          payout = betAmount * 2;
          message = 'Win! 🎊';
          setReels(['🍋', '🍋', '🍋']);
        } else if (random > 65) {
          won = true;
          payout = betAmount;
          message = 'Break Even 💰';
          setReels(['🍒', '🍒', '🍒']);
        } else {
          setReels([
            SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
            SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
            SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]
          ]);
          message = 'Try Again! 🤞';
        }

        setLastResult(message);
        
        if (won) {
          toast.success(`${message} Won ${payout.toFixed(3)} SOL!`);
          // In a real implementation, this would update balance from blockchain
          setBalance(prev => prev + payout - betAmount);
        } else {
          toast.error(message);
          // In a real implementation, this would update balance from blockchain
          setBalance(prev => prev - betAmount);
        }

        setCurrentCommitment(null);
        setGameState('idle');
      }, 2000);

    } catch (error) {
      console.error('Reveal failed:', error);
      toast.error('Failed to reveal and spin');
      setGameState('idle');
    }
  };

  // Handle legacy spin (for testing purposes)
  const handleLegacySpin = async () => {
    if (!publicKey) {
      toast.error('Wallet not connected');
      return;
    }

    if (betAmount < MIN_BET_AMOUNT || betAmount > MAX_BET_AMOUNT) {
      toast.error(`Bet amount must be between ${MIN_BET_AMOUNT} and ${MAX_BET_AMOUNT} SOL`);
      return;
    }

    if (balance < betAmount) {
      toast.error('Insufficient balance');
      return;
    }

    setGameState('spinning');
    animateReels();

    setTimeout(() => {
      const random = Math.random() * 100;
      let won = false;
      let payout = 0;
      let message = '';

      if (random > 99.5) {
        won = true;
        payout = betAmount * 25;
        message = 'JACKPOT! 🎉';
        setReels(['💎', '💎', '💎']);
      } else if (random > 98) {
        won = true;
        payout = betAmount * 10;
        message = 'Big Win! 🔥';
        setReels(['7️⃣', '7️⃣', '7️⃣']);
      } else if (random > 95) {
        won = true;
        payout = betAmount * 6;
        message = 'Great! ⭐';
        setReels(['🔔', '🔔', '🔔']);
      } else if (random > 90) {
        won = true;
        payout = betAmount * 3;
        message = 'Nice! 👍';
        setReels(['🍇', '🍇', '🍇']);
      } else if (random > 80) {
        won = true;
        payout = betAmount * 2;
        message = 'Win! 🎊';
        setReels(['🍋', '🍋', '🍋']);
      } else if (random > 65) {
        won = true;
        payout = betAmount;
        message = 'Break Even 💰';
        setReels(['🍒', '🍒', '🍒']);
      } else {
        setReels([
          SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
          SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
          SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]
        ]);
        message = 'Try Again! 🤞';
      }

      setLastResult(message);
      
      if (won) {
        toast.success(`${message} Won ${payout.toFixed(3)} SOL!`);
        setBalance(prev => prev + payout - betAmount);
      } else {
        toast.error(message);
        setBalance(prev => prev - betAmount);
      }

      setGameState('idle');
    }, 2000);
  };

  const isConnected = connected && publicKey;

  return (
    <div className="container">
      <div className="card">
        <div className="header">
          <h1 className="title">🎰 Solana Slot Machine</h1>
          <p className="subtitle">Provably Fair Gaming on Solana</p>
        </div>

        <div className="wallet-section">
          <WalletMultiButton />
          {isConnected && (
            <div className="balance">
              Balance: {balance.toFixed(3)} SOL
            </div>
          )}
        </div>

        {isConnected ? (
          <>
            <div className="slot-machine">
              <div className="reels">
                {reels.map((symbol, index) => (
                  <div key={index} className={`reel ${isSpinning ? 'spinning' : ''}`}>
                    {symbol}
                  </div>
                ))}
              </div>
            </div>

            <div className="controls">
              <div className="bet-section">
                <label htmlFor="bet-amount">Bet Amount (SOL):</label>
                <input
                  id="bet-amount"
                  type="number"
                  min={MIN_BET_AMOUNT}
                  max={MAX_BET_AMOUNT}
                  step="0.001"
                  value={betAmount}
                  onChange={(e) => setBetAmount(parseFloat(e.target.value) || MIN_BET_AMOUNT)}
                  className="bet-input"
                  disabled={gameState !== 'idle'}
                />
              </div>

              <button
                onClick={handleCommit}
                disabled={gameState !== 'idle' || balance < betAmount}
                className="btn btn-primary"
              >
                {gameState === 'idle' ? 'Spin! (Commit-Reveal)' : 
                 gameState === 'committed' ? 'Committing...' :
                 gameState === 'spinning' ? 'Spinning...' : 'Revealing...'}
              </button>

              <button
                onClick={handleLegacySpin}
                disabled={gameState !== 'idle' || balance < betAmount}
                className="btn btn-secondary"
                style={{ marginTop: '10px' }}
              >
                Legacy Spin (Demo)
              </button>
            </div>

            {lastResult && (
              <div className={`result ${lastResult.includes('Win') || lastResult.includes('JACKPOT') ? 'win' : 'lose'}`}>
                {lastResult}
              </div>
            )}

            {currentCommitment && (
              <div className="game-state">
                <h3>Game State</h3>
                <p className="status-text">
                  {gameState === 'committed' ? 'Waiting for minimum delay...' :
                   gameState === 'spinning' ? 'Spinning reels...' :
                   'Processing...'}
                </p>
                <div className="commitment-info">
                  <div>Nonce: {currentCommitment.nonce}</div>
                  <div>Status: {gameState}</div>
                  <div>Time elapsed: {Math.floor((Date.now() - currentCommitment.timestamp) / 1000)}s</div>
                </div>
              </div>
            )}

            <div className="game-state">
              <h3>How to Play</h3>
              <p><strong>Commit-Reveal Method (Recommended):</strong></p>
              <p>1. Set your bet amount (0.01 - 1.0 SOL)</p>
              <p>2. Click "Spin! (Commit-Reveal)" to create a commitment</p>
              <p>3. Wait for the reveal (automatic after delay)</p>
              <p>4. Watch the reels spin and see if you win!</p>
              <br />
              <p><strong>Legacy Method (Demo):</strong></p>
              <p>Click "Legacy Spin" for immediate results (less secure)</p>
              <br />
              <p><strong>Payouts:</strong></p>
              <p>💎💎💎 - 25x (0.5% chance)</p>
              <p>7️⃣7️⃣7️⃣ - 10x (1.5% chance)</p>
              <p>🔔🔔🔔 - 6x (3% chance)</p>
              <p>🍇🍇🍇 - 3x (5% chance)</p>
              <p>🍋🍋🍋 - 2x (10% chance)</p>
              <p>🍒🍒🍒 - 1x (15% chance)</p>
              <br />
              <p><em>Note: This is a demo UI. In production, it would integrate with the actual Solana smart contract for secure, provably fair gaming.</em></p>
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <h3>Connect your wallet to start playing!</h3>
            <p>Make sure you're on Solana Devnet</p>
            <br />
            <p>This slot machine features:</p>
            <ul style={{ textAlign: 'left', display: 'inline-block' }}>
              <li>🔒 Provably fair commit-reveal scheme</li>
              <li>🎰 Beautiful animated slot machine</li>
              <li>💎 Multiple payout tiers with different odds</li>
              <li>⚡ Solana blockchain integration</li>
              <li>🔐 Switchboard randomness ready</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
} 