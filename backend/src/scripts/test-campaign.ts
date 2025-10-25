// backend/src/scripts/test-campaign.ts

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import fs from 'fs';

/**
 * Script to create test environment for Airdrop Conductor
 * 1. Creates a test token
 * 2. Mints tokens to authority
 * 3. Generates test recipient addresses
 */

async function setupTestEnvironment() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  // Generate authority keypair (save this!)
  const authority = Keypair.generate();
  console.log('Authority Public Key:', authority.publicKey.toBase58());
  console.log('Authority Secret Key:', Buffer.from(authority.secretKey).toString('base64'));
  
  // Request airdrop for authority
  console.log('Requesting SOL airdrop...');
  const airdropSignature = await connection.requestAirdrop(
    authority.publicKey,
    2 * 1e9 // 2 SOL
  );
  await connection.confirmTransaction(airdropSignature);
  console.log('✅ Airdrop confirmed');
  
  // Create test token
  console.log('Creating test token...');
  const mint = await createMint(
    connection,
    authority,
    authority.publicKey, // mint authority
    null, // freeze authority
    9 // decimals
  );
  console.log('✅ Token Mint:', mint.toBase58());
  
  // Create token account for authority
  const tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    authority,
    mint,
    authority.publicKey
  );
  console.log('✅ Token Account:', tokenAccount.address.toBase58());
  
  // Mint 1,000,000 tokens
  await mintTo(
    connection,
    authority,
    mint,
    tokenAccount.address,
    authority,
    1_000_000 * 1e9 // 1M tokens
  );
  console.log('✅ Minted 1,000,000 tokens');
  
  // Generate 100 test recipient addresses
  const recipients = Array.from({ length: 100 }, () => ({
    address: Keypair.generate().publicKey.toBase58(),
    amount: Math.floor(Math.random() * 500) + 50, // Random 50-550
  }));
  
  // Save to CSV
  const csv = ['address,amount', ...recipients.map(r => `${r.address},${r.amount}`)].join('\n');
  fs.writeFileSync('test-recipients.csv', csv);
  console.log('✅ Generated test-recipients.csv with 100 addresses');
  
  // Save config
  const config = {
    authorityPublicKey: authority.publicKey.toBase58(),
    authoritySecretKey: Buffer.from(authority.secretKey).toString('base64'),
    tokenMint: mint.toBase58(),
    tokenDecimals: 9,
    sourceTokenAccount: tokenAccount.address.toBase58(),
  };
  
  fs.writeFileSync('test-config.json', JSON.stringify(config, null, 2));
  console.log('✅ Saved test-config.json');
  
  console.log('\n🎉 Test environment ready!');
  console.log('\nNext steps:');
  console.log('1. Use test-config.json values in your .env file');
  console.log('2. Upload test-recipients.csv when creating a campaign');
  console.log('3. Run campaign on devnet first before mainnet');
}

setupTestEnvironment().catch(console.error);