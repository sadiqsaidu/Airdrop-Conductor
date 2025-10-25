import {
  Connection,
  PublicKey,
  Keypair,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
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
  getBase64Encoder,
  createKeyPairSignerFromBytes,
} from '@solana/kit';
import { GatewayService } from './gateway.service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Local minimal KeyPairSigner shape so TS knows about it.
 *  If @solana/kit exports a KeyPairSigner type in your package version,
 *  prefer importing that instead of this local interface.
 */
interface KeyPairSigner {
  address: PublicKey;
  keyPair: Keypair;
  // other methods/fields may exist in the real object; keep minimal here
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
  private authority: KeyPairSigner;

  constructor(
    gatewayApiKey: string,
    rpcUrl: string,
    authorityPrivateKey: Uint8Array
  ) {
    this.gateway = new GatewayService({
      apiKey: gatewayApiKey,
      cluster: 'mainnet',
    });
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.rpc = createSolanaRpc(rpcUrl);
    // createKeyPairSignerFromBytes returns an object compatible with the local KeyPairSigner interface
    this.authority = createKeyPairSignerFromBytes(authorityPrivateKey) as unknown as KeyPairSigner;
  }

  async executeCampaign(campaignId: string) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { recipients: { where: { status: { in: ['pending', 'retrying'] } } } },
    });

    if (!campaign) {
      throw new Error('Campaign not found');
    }

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'running' },
    });

    // cast recipients from prisma result into our Recipient[] type
    const recipients = (campaign.recipients as unknown) as Recipient[];
    const batches = this.createBatches(recipients, campaign.batchSize);

    for (const batch of batches) {
      await this.processBatch(batch, campaign as unknown as Campaign);
      await this.sleep(500);
    }

    await this.updateCampaignStats(campaignId);
  }

  private async processBatch(batch: Recipient[], campaign: Campaign) {
    const promises = batch.map((recipient) =>
      this.sendTokenToRecipient(recipient, campaign)
    );

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
      // Several kit functions expect more specific types than TransactionInstruction,
      // so we cast where necessary to avoid TS errors while preserving runtime behavior.
      const unsignedTransaction = pipe(
        createTransactionMessage({ version: 0 }),
        (txm) => appendTransactionMessageInstructions([transferIx as unknown as any], txm),
        (txm) => setTransactionMessageFeePayerSigner(this.authority as unknown as any, txm),
        // Gateway will replace blockhash — use a placeholder and cast its type
        (m) =>
          setTransactionMessageLifetimeUsingBlockhash(
            {
              // cast the placeholder string to the nominal Blockhash type expected by the lib
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

      const buildResult = await this.gateway.buildGatewayTransaction(
        unsignedTransaction as any,
        gatewayParams as any
      );

      // decode optimized transaction and sign
      const optimizedTx = getTransactionDecoder().decode(
        getBase64Encoder().encode(buildResult.transaction)
      );

      // signTransaction expects a TransactionWithLifetime or similar; cast to any to satisfy TS
      const signedTx = await signTransaction([this.authority.keyPair] as unknown as any, optimizedTx as any);

      const signature = await this.gateway.sendTransaction(signedTx);

      console.log(`✅ Transaction sent: ${signature}`);

      await prisma.recipient.update({
        where: { id: recipient.id },
        data: {
          status: 'sent',
          txSignature: signature,
          attempts: recipient.attempts + 1,
        },
      });

      // monitorConfirmation can accept the buildResult.latestBlockhash as any (it will be used at runtime)
      this.monitorConfirmation(recipient.id, signature, buildResult.latestBlockhash as any);

      return signature;
    } catch (error: any) {
      console.error(`❌ Failed to send to ${recipient.address}:`, error?.message || error);
      await this.handleFailure(recipient, campaign, error);
    }
  }

  private async monitorConfirmation(
    recipientId: string,
    signature: string,
    // accept any because different kit versions return different shapes here
    latestBlockhash: any
  ) {
    try {
      // latestBlockhash may have string lastValidBlockHeight; ensure numeric when calling web3
      const lastValidBlockHeight = typeof latestBlockhash?.lastValidBlockHeight === 'bigint'
        ? latestBlockhash.lastValidBlockHeight
        : BigInt(Number(latestBlockhash?.lastValidBlockHeight || 0));

      const confirmation = await this.connection.confirmTransaction({
        signature,
        blockhash: latestBlockhash?.blockhash,
        lastValidBlockHeight: Number(lastValidBlockHeight),
      });

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

      console.log(`✅ Confirmed: ${signature}`);
    } catch (error: any) {
      console.error(`Confirmation failed for ${signature}:`, error);
      await prisma.recipient.update({
        where: { id: recipientId },
        data: { status: 'failed', lastError: (error as Error).message },
      });
    }
  }

  private async handleFailure(
    recipient: Recipient,
    campaign: Campaign,
    error: Error
  ) {
    const newAttempts = recipient.attempts + 1;

    if (newAttempts < campaign.maxRetries) {
      await prisma.recipient.update({
        where: { id: recipient.id },
        data: {
          status: 'retrying',
          attempts: newAttempts,
          lastError: error.message,
        },
      });

      const delay = Math.pow(2, newAttempts) * 1000;
      setTimeout(() => {
        this.sendTokenToRecipient(recipient, campaign);
      }, delay);
    } else {
      await prisma.recipient.update({
        where: { id: recipient.id },
        data: {
          status: 'failed',
          attempts: newAttempts,
          lastError: error.message,
        },
      });
    }
  }

  private async updateCampaignStats(campaignId: string) {
    // cast stats to any[] so TS doesn't complain about fields produced by groupBy
    const stats = (await prisma.recipient.groupBy({
      by: ['status'],
      where: { campaignId },
      _count: true,
      _sum: { feesPaid: true },
    })) as any[];

    const totalConfirmed = stats.find((s: any) => s.status === 'confirmed')?._count || 0;
    const totalFailed = stats.find((s: any) => s.status === 'failed')?._count || 0;
    const totalSOLSpent = stats.reduce((sum: number, s: any) => sum + Number(s._sum?.feesPaid || 0), 0);

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
