export type CampaignStatus = "pending" | "running" | "completed" | "failed";

export interface Recipient {
  id: string;
  address: string;
  amount: number;
  status: string;
  txHash?: string;
}

export interface Campaign {
  id: string;
  name: string;
  tokenMint: string;
  tokenDecimals: number;
  totalRecipients: number;
  totalConfirmed: number;
  totalFailed: number;
  totalSOLSpent: number;
  status: CampaignStatus;
  recipients?: Recipient[];
}

export interface CampaignFormData {
  name: string;
  tokenMint: string;
  tokenDecimals: string;
  sourceTokenAccount: string;
  authorityWallet: string;
  mode: "cost-saver" | "high-assurance";
  batchSize: string;
  maxRetries: string;
  file: File | null;
}
