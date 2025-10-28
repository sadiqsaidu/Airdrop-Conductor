// backend/src/services/distributor.service.ts
import {
  Connection,
  PublicKey,
  Keypair,
  TransactionInstruction,
  TransactionSignature,
} from '@solana/web3.js';
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  createSolanaRpc,
  createTransactionMessage,
  appendTransactionMessageInstructions,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  compileTransaction,
  pipe,
  signTransaction,
  getTransactionDecoder,
  // getBase64Encoder,   // not used now
  createKeyPairSignerFromBytes,
  // getBase64EncodedWireTransaction might exist or not depending on kit version
  // we'll attempt to import it dynamically below
} from '@solana/kit';
import { GatewayService } from './gateway.service';
import { PrismaClient } from '@prisma/client';
import { Buffer } from 'buffer';

const prisma = new PrismaClient();

interface KeyPairSignerLocal {
  address: PublicKey;
  keyPair: Keypair;
}

interface Campaign {
  id: string;
  mode: 'cost-saver' | 'high-assurance';
  tokenMint: string;
  tokenDecimals: number;
  sourceTokenAccount: string;
  authorityWallet: string;
  batchSize: number;
  maxRetries: number;
}

interface Recipient {
  id: string;
  address: string;
  amount: number;
  attempts: number;
}

export class DistributorService {
  private gateway: GatewayService;
  private connection: Connection;
  private rpc: ReturnType<typeof createSolanaRpc>;
  private authority: KeyPairSignerLocal;

  constructor(
    gatewayApiKey: string,
    rpcUrl: string,
    authorityPrivateKey: Uint8Array | Buffer,
  ) {
    const envCluster = process.env.GATEWAY_CLUSTER as ('devnet' | 'mainnet') | undefined;
    const inferred = rpcUrl.includes('devnet') ? 'devnet' : 'mainnet';
    const cluster = envCluster ?? inferred;

    this.gateway = new GatewayService({ apiKey: gatewayApiKey, cluster });
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.rpc = createSolanaRpc(rpcUrl);

    const keyBytes = Buffer.from(authorityPrivateKey);
    if (keyBytes.length === 32) {
      const kp = Keypair.fromSeed(Uint8Array.from(keyBytes));
      this.authority = { address: kp.publicKey, keyPair: kp };
    } else {
      try {
        const signer = createKeyPairSignerFromBytes(Uint8Array.from(keyBytes)) as any;
        if (signer?.keyPair) {
          this.authority = { address: signer.address, keyPair: signer.keyPair };
        } else {
          const kp = Keypair.fromSecretKey(Uint8Array.from(keyBytes));
          this.authority = { address: kp.publicKey, keyPair: kp };
        }
      } catch (err) {
        const kp = Keypair.fromSecretKey(Uint8Array.from(keyBytes));
        this.authority = { address: kp.publicKey, keyPair: kp };
      }
    }
  }

  async executeCampaign(campaignId: string) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { recipients: { where: { status: { in: ['pending', 'retrying'] } } } },
    });

    if (!campaign) throw new Error('Campaign not found');

    await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'running' } });

    const recipients = (campaign.recipients as unknown) as Recipient[];
    const batches = this.createBatches(recipients, (campaign as any).batchSize || 10);

    for (const batch of batches) {
      await this.processBatch(batch, campaign as unknown as Campaign);
      await this.sleep(500);
    }

    await this.updateCampaignStats(campaignId);
  }

  private async processBatch(batch: Recipient[], campaign: Campaign) {
    const promises = batch.map((recipient) => this.sendTokenToRecipient(recipient, campaign));
    await Promise.allSettled(promises);
  }

  // Gateway-integrated token sending with ATA creation and strong diagnostics
  private async sendTokenToRecipient(recipient: Recipient, campaign: Campaign) {
    try {
      console.log(`Processing recipient: ${recipient.address}`);

      const tokenMint = new PublicKey(campaign.tokenMint);
      const recipientWallet = new PublicKey(recipient.address);
      const sourceAccount = new PublicKey(campaign.sourceTokenAccount);

      const recipientATA = await getAssociatedTokenAddress(
        tokenMint,
        recipientWallet,
        false,
        TOKEN_PROGRAM_ID
      );

      console.log(`Recipient ATA: ${recipientATA.toString()}`);

      // Check if recipient token account exists
      const recipientAccountInfo = await this.connection.getAccountInfo(recipientATA);
      const instructions: TransactionInstruction[] = [];

      if (!recipientAccountInfo) {
        console.log(`📝 Creating token account for ${recipient.address}`);
        const { createAssociatedTokenAccountInstruction } = await import('@solana/spl-token');

        const createATAIx = createAssociatedTokenAccountInstruction(
          this.authority.address,
          recipientATA,
          recipientWallet,
          tokenMint
        );

        instructions.push(createATAIx);
      }

      // Add transfer instruction
      const transferIx = createTransferInstruction(
        sourceAccount,
        recipientATA,
        this.authority.address,
        BigInt(Math.floor(recipient.amount * Math.pow(10, campaign.tokenDecimals))),
        [],
        TOKEN_PROGRAM_ID
      );

      instructions.push(transferIx);

      console.log(`🔧 Building transaction with ${instructions.length} instruction(s)...`);

      // Build unsigned transaction via kit pipeline
      const unsignedTransaction = pipe(
        createTransactionMessage({ version: 0 }),
        (txm) => appendTransactionMessageInstructions(instructions.map(ix => ix as any), txm),
        (txm) => setTransactionMessageFeePayerSigner(this.authority as any, txm),
        (m) =>
          setTransactionMessageLifetimeUsingBlockhash(
            {
              blockhash: '11111111111111111111111111111111' as any,
              lastValidBlockHeight: 1000n,
            } as any,
            m
          ),
        compileTransaction
      );

      console.log('✅ Transaction compiled. Now encoding to base64 for Gateway...');

      // --- Robust serialization to base64 (try kit helper, then fallbacks) ---
      let compiledBase64: string | null = null;

      // 1) try kit helper if available
      try {
        // dynamic require to avoid TS errors if function not present
        const maybeKit: any = await import('@solana/kit');
        if (typeof maybeKit.getBase64EncodedWireTransaction === 'function') {
          compiledBase64 = maybeKit.getBase64EncodedWireTransaction(unsignedTransaction);
          console.log('Used kit.getBase64EncodedWireTransaction()');
        }
      } catch (e) {
        // ignore - we'll try fallbacks
      }

      // 2) fallback: if the unsignedTransaction has .serialize()
      if (!compiledBase64) {
        try {
          if (typeof (unsignedTransaction as any).serialize === 'function') {
            const bytes = (unsignedTransaction as any).serialize();
            compiledBase64 = Buffer.from(bytes).toString('base64');
            console.log('Used unsignedTransaction.serialize() fallback');
          }
        } catch (e) {
          // ignore and continue to other fallbacks
        }
      }

      // 3) fallback: look for messageBytes or raw Uint8Array
      if (!compiledBase64) {
        try {
          const msgBytes = (unsignedTransaction as any).messageBytes ?? (unsignedTransaction as any).message?.bytes;
          if (msgBytes && (msgBytes instanceof Uint8Array || Array.isArray(msgBytes))) {
            compiledBase64 = Buffer.from(msgBytes as any).toString('base64');
            console.log('Used unsignedTransaction.messageBytes fallback');
          } else if (unsignedTransaction instanceof Uint8Array) {
            compiledBase64 = Buffer.from(unsignedTransaction).toString('base64');
            console.log('Used unsignedTransaction (Uint8Array) fallback');
          }
        } catch (e) {
          // ignore
        }
      }

      // If still nothing, fail with diagnostics
      if (!compiledBase64) {
        console.error('❌ Could not produce a base64 wire-transaction from unsignedTransaction. Dumping object for debugging:');
        // DO NOT stringify huge binary directly; log keys + small sample
        try {
          console.error('unsignedTransaction keys:', Object.keys(unsignedTransaction as any));
          const sample = JSON.stringify((unsignedTransaction as any).messageBytes ? { messageBytesLength: (unsignedTransaction as any).messageBytes.length } : {});
          console.error('unsignedTransaction sample:', sample);
        } catch (e) {
          console.error('unsignedTransaction introspect failed:', e);
        }
        throw new Error('Failed to serialize compiled transaction for Gateway (no valid fallback).');
      }

      // Sanity checks
      const compiledBytes = Buffer.from(compiledBase64, 'base64');
      console.log(`Compiled base64 length: ${compiledBase64.length} chars, bytes length: ${compiledBytes.length}`);
      console.log(`Compiled bytes hex (first 48 chars): ${compiledBytes.toString('hex').slice(0, 48)}`);

      // Gateway params
      const gatewayParams =
        campaign.mode === 'high-assurance'
          ? {
              cuPriceRange: 'high' as const,
              jitoTipRange: 'high' as const,
              skipPreflight: false,
            }
          : {
              cuPriceRange: 'low' as const,
              skipPreflight: false,
            };

      console.log(`Gateway mode: ${campaign.mode}`, gatewayParams);

      // SEND to Gateway
      console.log('📤 Sending compiledBase64 to Gateway.buildGatewayTransaction()...');
      const buildResult: any = await this.gateway.buildGatewayTransaction(compiledBase64, gatewayParams as any);

      console.log('📥 Gateway returned buildResult. Dumping types & sizes for debugging:');
      try {
        console.log('buildResult keys:', Object.keys(buildResult || {}));
        console.log('buildResult.transaction type:', typeof buildResult?.transaction);
        if (typeof buildResult?.transaction === 'string') {
          console.log('buildResult.transaction length:', (buildResult.transaction as string).length);
          const b = Buffer.from(buildResult.transaction as string, 'base64');
          console.log('buildResult.transaction decoded bytes length:', b.length);
          console.log('buildResult.transaction decoded hex (first 48 chars):', b.toString('hex').slice(0, 48));
        } else {
          console.log('buildResult.transaction (non-string) preview:', JSON.stringify(buildResult.transaction).slice(0, 200));
        }
        console.log('buildResult.latestBlockhash:', JSON.stringify(buildResult.latestBlockhash).slice(0, 200));
      } catch (e) {
        console.warn('Failed to log buildResult details:', e);
      }

      // Decode optimized transaction bytes safely
      let optimizedTx: any;
      try {
        if (typeof buildResult.transaction === 'string') {
          const txBytes = Buffer.from(buildResult.transaction, 'base64');
          optimizedTx = getTransactionDecoder().decode(Uint8Array.from(txBytes));
        } else if (buildResult.transaction instanceof Uint8Array) {
          optimizedTx = getTransactionDecoder().decode(buildResult.transaction);
        } else {
          // last resort: attempt to JSON->string->base64 decode (unlikely)
          const maybe = JSON.stringify(buildResult.transaction);
          const tryBytes = Buffer.from(maybe);
          optimizedTx = getTransactionDecoder().decode(Uint8Array.from(tryBytes));
        }
      } catch (e) {
        console.error('❌ Failed to decode buildResult.transaction into optimizedTx:', e);
        console.error('buildResult (raw):', buildResult);
        throw e;
      }

      // Sign
      let signedTx: any;
      try {
        signedTx = await signTransaction([this.authority.keyPair] as any, optimizedTx as any);
      } catch (e) {
        console.error('❌ signTransaction failed:', e);
        throw e;
      }

      console.log('✅ Transaction signed locally. Now sending through Gateway.sendTransaction()');

      // NOTE: gateway.sendTransaction may expect base64 or signed tx object depending on implementation.
      // We'll try to send the signed object; if that fails, also try serialized base64.
      let signature: TransactionSignature | null = null;
      try {
        signature = await this.gateway.sendTransaction(signedTx);
      } catch (eSend1: any) {
        console.warn('gateway.sendTransaction(signedTx) failed, attempting fallback to base64 serialized signed tx. Error:', eSend1?.message || eSend1);
        try {
          const serialized = (signedTx as any)?.serialize ? (signedTx as any).serialize() : null;
          if (serialized) {
            const signedBase64 = Buffer.from(serialized).toString('base64');
            signature = await this.gateway.sendTransaction(signedBase64);
          } else {
            throw eSend1;
          }
        } catch (eSend2: any) {
          console.error('All attempts to send transaction via Gateway failed:', eSend2?.message || eSend2);
          throw eSend2;
        }
      }

      console.log(`✅ Transaction sent: ${signature}`);

      await prisma.recipient.update({
        where: { id: recipient.id },
        data: {
          status: 'sent',
          txSignature: signature as string,
          attempts: recipient.attempts + 1,
        },
      });

      // Kick off confirmation monitor (does not block)
      this.monitorConfirmation(recipient.id, signature as string, buildResult.latestBlockhash as any);

      return signature;
    } catch (error: any) {
      console.error(`❌ Failed to send to ${recipient.address}:`, error?.message || error);
      // Dump the full error if available
      if (error?.response) {
        console.error('Error response body:', JSON.stringify(error.response.data || error.response, null, 2));
      }
      await this.handleFailure(recipient, campaign, error);
    }
  }

  // Enhanced confirmation monitoring
  private async monitorConfirmation(
    recipientId: string,
    signature: string,
    latestBlockhash: any
  ) {
    try {
      console.log(`⏳ Monitoring confirmation for ${signature}...`);

      const lastValidBlockHeight =
        typeof latestBlockhash?.lastValidBlockHeight === 'bigint'
          ? latestBlockhash.lastValidBlockHeight
          : BigInt(latestBlockhash?.lastValidBlockHeight || 0);

      const confirmation = await this.connection.confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash?.blockhash,
          lastValidBlockHeight: Number(lastValidBlockHeight),
        },
        'confirmed'
      );

      if (confirmation.value.err) {
        throw new Error('Transaction failed on-chain');
      }

      const txDetails = await this.connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });

      const feePaid = txDetails?.meta?.fee || 0;

      await prisma.recipient.update({
        where: { id: recipientId },
        data: {
          status: 'confirmed',
          confirmedAt: new Date(),
          feesPaid: feePaid / 1_000_000_000,
        },
      });

      console.log(`✅ Confirmed: ${signature} (fee: ${feePaid / 1_000_000_000} SOL)`);
    } catch (error: any) {
      console.error(`❌ Confirmation failed for ${signature}:`, error?.message || error);

      await prisma.recipient.update({
        where: { id: recipientId },
        data: {
          status: 'failed',
          lastError: error?.message || 'Confirmation timeout',
        },
      });
    }
  }

  private async handleFailure(recipient: Recipient, campaign: Campaign, error: Error) {
    const newAttempts = recipient.attempts + 1;

    if (newAttempts < campaign.maxRetries) {
      await prisma.recipient.update({
        where: { id: recipient.id },
        data: { status: 'retrying', attempts: newAttempts, lastError: error.message },
      });

      const delay = Math.pow(2, newAttempts) * 1000;
      setTimeout(() => void this.sendTokenToRecipient(recipient, campaign), delay);
    } else {
      await prisma.recipient.update({
        where: { id: recipient.id },
        data: { status: 'failed', attempts: newAttempts, lastError: error.message },
      });
    }
  }

  // Type-safe Prisma aggregation fix
  private async updateCampaignStats(campaignId: string) {
    const groupArgs: any = {
      by: ['status'],
      where: { campaignId },
      _count: true,
      _sum: { feesPaid: true },
    };

    const stats = (await (prisma.recipient as any).groupBy(groupArgs)) as any[];

    const totalConfirmed =
      stats.find((s: any) => s.status === 'confirmed')?._count || 0;
    const totalFailed =
      stats.find((s: any) => s.status === 'failed')?._count || 0;

    const totalSOLSpent = stats.reduce((sum: number, s: any) => {
      const fees = s._sum?.feesPaid;
      return sum + (fees ? Number(fees) : 0);
    }, 0);

    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        totalConfirmed,
        totalFailed,
        totalSOLSpent,
        status: 'completed',
      },
    });
  }

  private createBatches<T>(array: T[], size: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      batches.push(array.slice(i, i + size));
    }
    return batches;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
