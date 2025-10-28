// backend/src/services/gateway.service.ts
import fetch from 'node-fetch';

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
  transaction: string; // base64 encoded transaction
  latestBlockhash: {
    blockhash: string;
    lastValidBlockHeight: string | number | bigint;
  };
}

export class GatewayService {
  private readonly baseUrl = 'https://tpg.sanctum.so/v1';
  private readonly apiKey: string;
  private readonly cluster: string;

  constructor(config: GatewayConfig) {
    this.apiKey = config.apiKey;
    this.cluster = config.cluster;
  }

  private async callRpc(method: string, params: any[]): Promise<any> {
    const url = `${this.baseUrl}/${this.cluster}?apiKey=${encodeURIComponent(this.apiKey)}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: `${method}-${Date.now()}`,
        jsonrpc: '2.0',
        method,
        params,
      }),
    });

    const text = await resp.text().catch(() => '');

    if (!resp.ok) {
      throw new Error(`Gateway ${method} failed: ${resp.status} ${resp.statusText} ${text}`);
    }

    let data: any;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (err) {
      throw new Error(`Gateway ${method} returned invalid JSON: ${err}`);
    }

    if (data.error) {
      const errMsg = data.error?.message ?? JSON.stringify(data.error);
      throw new Error(`Gateway error: ${errMsg}`);
    }

    return data.result ?? data;
  }

  async buildGatewayTransaction(
    unsignedTransaction: any,
    params?: BuildTransactionParams
  ): Promise<BuildTransactionResponse> {
    const result = await this.callRpc('buildGatewayTransaction', [
      // Expecting a base64 wire tx string from the kit-side caller
      unsignedTransaction,
      {
        encoding: 'base64',
        cuPriceRange: params?.cuPriceRange,
        jitoTipRange: params?.jitoTipRange,
        expireInSlots: params?.expireInSlots,
        skipSimulation: params?.skipSimulation ?? false,
        skipPriorityFee: params?.skipPriorityFee ?? false,
      },
    ]);

    return result as BuildTransactionResponse;
  }

  async sendTransaction(signedTransactionBase64: string, startSlot?: number): Promise<string> {
    const result = await this.callRpc('sendTransaction', [
      signedTransactionBase64,
      { encoding: 'base64', startSlot },
    ]);

    return result as string;
  }

  async getTipInstructions(feePayer: string, params?: {
    jitoTipRange?: 'low' | 'medium' | 'high' | 'max';
    deliveryMethodType?: 'rpc' | 'jito' | 'sanctum-sender' | 'helius-sender';
  }) {
    const result = await this.callRpc('getTipInstructions', [{
      feePayer,
      jitoTipRange: params?.jitoTipRange,
      deliveryMethodType: params?.deliveryMethodType,
    }]);
    return result;
  }
}
