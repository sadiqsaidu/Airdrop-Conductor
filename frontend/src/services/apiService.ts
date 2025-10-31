// src/services/apiService.ts
import { JobStatus, Task } from '../types';

// Cast import.meta to any to avoid "Property 'env' does not exist on type 'ImportMeta'" TS error
const API_BASE_URL =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:4000/api';

export const createJob = async (formData: FormData): Promise<any> => {
  const response = await fetch(`${API_BASE_URL}/create-job`, {
    method: 'POST',
    body: formData,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to create job');
  }
  return data;
};

export const getUnsignedTransactions = async (jobId: string): Promise<any> => {
  const response = await fetch(`${API_BASE_URL}/get-unsigned-transactions/${jobId}`);
  if (!response.ok) throw new Error('Failed to fetch unsigned transactions');
  return response.json();
};

export const submitSignedTransactions = async (
  jobId: string,
  signedTransactions: Array<{ task_id: number; transaction: string }>
): Promise<any> => {
  const response = await fetch(`${API_BASE_URL}/submit-signed-transactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      job_id: jobId,
      signed_transactions: signedTransactions,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to submit signed transactions');
  }
  return data;
};

export const getJobStatus = async (jobId: string): Promise<JobStatus> => {
  const response = await fetch(`${API_BASE_URL}/job-status/${jobId}`);
  if (!response.ok) throw new Error('Failed to fetch job status');
  return response.json();
};

export const getJobTasks = async (jobId: string): Promise<{ tasks: Task[] }> => {
  const response = await fetch(`${API_BASE_URL}/job-tasks/${jobId}`);
  if (!response.ok) throw new Error('Failed to fetch tasks');
  return response.json();
};

export const downloadTemplate = (): void => {
  window.open(`${API_BASE_URL}/csv-template`, '_blank');
};