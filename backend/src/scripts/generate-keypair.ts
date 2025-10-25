// generate-keypair.js
const { Keypair } = require('@solana/web3.js');
const kp = Keypair.generate();
console.log('Public key:', kp.publicKey.toBase58());
console.log('Base64 secret (WALLET_PRIVATE_KEY):', Buffer.from(kp.secretKey).toString('base64'));

