// backend/src/services/distributor.service.ts
import {
  Connection,
  PublicKey,
  Keypair,
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
  createKeyPairSignerFromBytes,
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

  private async sendTokenToRecipient(recipient: Recipient, campaign: Campaign) {
    try {
      console.log(`Processing recipient: ${recipient.address}`);

      const recipientATA = await getAssociatedTokenAddress(
        new PublicKey(campaign.tokenMint),
        new PublicKey(recipient.address)
      );

      const transferIx = createTransferInstruction(
        new PublicKey(campaign.sourceTokenAccount),
        recipientATA,
        this.authority.address,
        BigInt(Math.floor(recipient.amount * Math.pow(10, campaign.tokenDecimals))),
        [],
        TOKEN_PROGRAM_ID
      );

      // Build unsigned transaction using kit pipeline.
      const unsignedTransaction = pipe(
        createTransactionMessage({ version: 0 }),
        (txm) => appendTransactionMessageInstructions([transferIx as unknown as any], txm),
        (txm) => setTransactionMessageFeePayerSigner(this.authority as unknown as any, txm),
        (m) =>
          setTransactionMessageLifetimeUsingBlockhash(
            {
              blockhash: ('11111111111111111111111111111111' as unknown) as any,
              lastValidBlockHeight: 1000n,
            } as any,
            m
          ),
        compileTransaction
      );

      const gatewayParams = campaign.mode === 'high-assurance'
        ? { cuPriceRange: 'high' as const, jitoTipRange: 'high' as const }
        : { cuPriceRange: 'low' as const };

      // Build via Gateway (pass base64 string). Attempt to create a base64 of compiled tx safely:
      const compiledBase64 = ((): string => {
        try {
          const compiled = unsignedTransaction as any;
          if (compiled?.serialize) {
            return Buffer.from(compiled.serialize()).toString('base64');
          }
          if (typeof compiled === 'string') return compiled;
          return Buffer.from(JSON.stringify(compiled)).toString('base64');
        } catch (e) {
          return Buffer.from(JSON.stringify(unsignedTransaction)).toString('base64');
        }
      })();

      const base64BuildResult = await this.gateway.buildGatewayTransaction(compiledBase64, gatewayParams as any);

      const buildResult = base64BuildResult as any as {
        transaction: string;
        latestBlockhash: any;
      };

      // decode base64 -> bytes
      const txBytes = Buffer.from(buildResult.transaction, 'base64');
      const optimizedTx = getTransactionDecoder().decode(Uint8Array.from(txBytes));

      const signedTx = await signTransaction([this.authority.keyPair] as any, optimizedTx as any);

      let signedBase64: string;
      try {
        if (signedTx?.serialize) {
          signedBase64 = Buffer.from((signedTx as any).serialize()).toString('base64');
        } else if (typeof signedTx === 'string') {
          signedBase64 = signedTx;
        } else {
          signedBase64 = Buffer.from(JSON.stringify(signedTx)).toString('base64');
        }
      } catch (err) {
        signedBase64 = Buffer.from(JSON.stringify(signedTx)).toString('base64');
      }

      const signature = (await this.gateway.sendTransaction(signedBase64)) as TransactionSignature;

      console.log(`✅ Transaction sent: ${signature}`);

      await prisma.recipient.update({
        where: { id: recipient.id },
        data: { status: 'sent', txSignature: signature, attempts: recipient.attempts + 1 },
      });

      this.monitorConfirmation(recipient.id, signature, buildResult.latestBlockhash);

      return signature;
    } catch (error: any) {
      console.error(`❌ Failed to send to ${recipient.address}:`, error?.message ?? error);
      await this.handleFailure(recipient, campaign, error);
    }
  }

  private async monitorConfirmation(recipientId: string, signature: string, latestBlockhash: any) {
    try {
      const lastValidBlockHeight =
        typeof latestBlockhash?.lastValidBlockHeight === 'bigint'
          ? latestBlockhash.lastValidBlockHeight
          : BigInt(Number(latestBlockhash?.lastValidBlockHeight || 0));

      await this.connection.confirmTransaction({
        signature,
        blockhash: latestBlockhash?.blockhash,
        lastValidBlockHeight: Number(lastValidBlockHeight),
      });

      const txDetails = await this.connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });

      const feePaid = txDetails?.meta?.fee || 0;

      await prisma.recipient.update({
        where: { id: recipientId },
        data: { status: 'confirmed', confirmedAt: new Date(), feesPaid: feePaid / 1_000_000_000 },
      });

      console.log(`✅ Confirmed: ${signature}`);
    } catch (error: any) {
      console.error(`Confirmation failed for ${signature}:`, error);
      await prisma.recipient.update({
        where: { id: recipientId },
        data: { status: 'failed', lastError: (error as Error).message },
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

  private async updateCampaignStats(campaignId: string) {
    // Build args as `any` to avoid TS expanding Prisma mapped types and causing circular-type errors.
    const groupArgs: any = {
      by: ['status'],
      where: { campaignId },
      _count: true,
      _sum: { feesPaid: true },
    };

    // Force the Prisma client call through `any` so TypeScript doesn't try to evaluate deep mapped types.
    const rawStats = await (prisma.recipient as any).groupBy(groupArgs) as any[];

    // Helper to safely extract the numeric count from various shapes Prisma might return
    const extractCount = (countField: any): number => {
      if (countField == null) return 0;
      if (typeof countField === 'number') return countField;
      // Prisma sometimes returns { _all: number } or { _all: { some nested } } - handle common shapes
      if (typeof countField._all === 'number') return countField._all;
      if (typeof countField._all === 'object' && typeof (countField._all as any).value === 'number') {
        return (countField._all as any).value;
      }
      // fallback: try 'count' or 'total'
      if (typeof countField.count === 'number') return countField.count;
      if (typeof countField.total === 'number') return countField.total;
      return 0;
    };

    // Safely extract fee sums
    const extractFees = (sumField: any): number => {
      if (sumField == null) return 0;
      if (typeof sumField === 'number') return sumField;
      if (typeof sumField.feesPaid === 'number') return sumField.feesPaid;
      if (typeof sumField.feesPaid === 'object' && typeof sumField.feesPaid.value === 'number') return sumField.feesPaid.value;
      return 0;
    };

    const stats = rawStats || [];

    const totalConfirmed = stats.find((s) => s.status === 'confirmed')
      ? extractCount(stats.find((s) => s.status === 'confirmed')._count)
      : 0;

    const totalFailed = stats.find((s) => s.status === 'failed')
      ? extractCount(stats.find((s) => s.status === 'failed')._count)
      : 0;

    const totalSOLSpent = stats.reduce((sum: number, s: any) => sum + Number(extractFees(s._sum)), 0);

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { totalConfirmed, totalFailed, totalSOLSpent, status: 'completed' },
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
