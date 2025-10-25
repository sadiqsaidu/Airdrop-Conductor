import {
  createSolanaRpc,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  signTransaction,
  type KeyPairSigner,
} from "@solana/kit";


interface GatewayConfig {
  apiKey: string;
  cluster: 'mainnet' | 'devnet';
}

interface BuildTransactionParams {
  cuPriceRange?: 'low' | 'medium' | 'high';
  jitoTipRange?: 'low' | 'medium' | 'high' | 'max';
  expireInSlots?: number;
  skipSimulation?: boolean;
  skipPriorityFee?: boolean;
}

interface BuildTransactionResponse {
  transaction: string; // base64 encoded
  latestBlockhash: {
    blockhash: string;
    lastValidBlockHeight: string;
  };
}

export class GatewayService {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly cluster: string;

  constructor(config: GatewayConfig) {
    this.apiKey = config.apiKey;
    this.cluster = config.cluster;
    this.baseUrl = `https://tpg.sanctum.so/v1/${this.cluster}?apiKey=${this.apiKey}`;
  }

  /**
   * Build and optimize transaction using Gateway
   * This replaces the deprecated optimizeTransaction
   */
  async buildGatewayTransaction(
    unsignedTransaction: any, // was: CompiledTransaction
    params?: BuildTransactionParams
  ): Promise<BuildTransactionResponse> {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `build-${Date.now()}`,
          jsonrpc: '2.0',
          method: 'buildGatewayTransaction',
          params: [
            getBase64EncodedWireTransaction(unsignedTransaction),
            {
              encoding: 'base64',
              cuPriceRange: params?.cuPriceRange,
              jitoTipRange: params?.jitoTipRange,
              expireInSlots: params?.expireInSlots,
              skipSimulation: params?.skipSimulation || false,
              skipPriorityFee: params?.skipPriorityFee || false,
            }
          ],
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Gateway buildTransaction failed: ${error}`);
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(`Gateway error: ${data.error.message}`);
      }

      return data.result;
    } catch (error) {
      console.error('buildGatewayTransaction error:', error);
      throw error;
    }
  }

  /**
   * Send signed transaction through Gateway
   */
  async sendTransaction(
    signedTransaction: any, // was: CompiledTransaction
    startSlot?: number
  ): Promise<string> {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `send-${Date.now()}`,
          jsonrpc: '2.0',
          method: 'sendTransaction',
          params: [
            getBase64EncodedWireTransaction(signedTransaction),
            {
              encoding: 'base64',
              startSlot: startSlot,
            }
          ],
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Gateway sendTransaction failed: ${error}`);
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(`Gateway error: ${data.error.message}`);
      }

      return data.result; // Transaction signature
    } catch (error) {
      console.error('sendTransaction error:', error);
      throw error;
    }
  }

  /**
   * Get tip instructions for manual transaction building
   */
  async getTipInstructions(
    feePayer: string,
    params?: {
      jitoTipRange?: 'low' | 'medium' | 'high' | 'max';
      deliveryMethodType?: 'rpc' | 'jito' | 'sanctum-sender' | 'helius-sender';
    }
  ) {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `tips-${Date.now()}`,
          jsonrpc: '2.0',
          method: 'getTipInstructions',
          params: [{
            feePayer,
            jitoTipRange: params?.jitoTipRange,
            deliveryMethodType: params?.deliveryMethodType,
          }],
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get tip instructions');
      }

      const data = await response.json();
      return data.result;
    } catch (error) {
      console.error('getTipInstructions error:', error);
      throw error;
    }
  }
}