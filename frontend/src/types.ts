export interface JobStatus {
  job_id: string;
  job_status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  total: number;
  success: number;
  failed: number;
  pending: number;
  processing: number;
  token_mint: string;
  token_decimals: number;
  distributor_address?: string;
  mode: string;
  error_message?: string;
  created_at?: string;
}

export interface Task {
  task_id: number;
  recipient_address: string;
  amount: string;
  status: 'pending' | 'processing' | 'success' | 'failed';
  tx_signature: string | null;
  retry_count?: number;
  error_message?: string;
}