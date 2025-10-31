import { JobStatus, Task } from '../types';

const API_BASE_URL = 'http://localhost:4000/api';

export const startJob = async (formData: FormData): Promise<JobStatus> => {
  const response = await fetch(`${API_BASE_URL}/start-job`, {
    method: 'POST',
    body: formData,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to start job');
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

export const cancelJob = async (jobId: string): Promise<Response> => {
  return fetch(`${API_BASE_URL}/cancel-job/${jobId}`, { method: 'POST' });
};

export const downloadTemplate = (): void => {
  window.open(`${API_BASE_URL}/csv-template`, '_blank');
};