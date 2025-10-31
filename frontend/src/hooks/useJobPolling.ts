import { useState, useEffect, useRef, useCallback } from 'react';
import { JobStatus, Task } from '../types';
import { getJobStatus, getJobTasks } from '../services/apiService';

export const useJobPolling = (jobId: string | null) => {
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollingRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const pollData = useCallback(async () => {
    if (!jobId) return;

    try {
      const statusData = await getJobStatus(jobId);
      setJobStatus(statusData);

      if (['completed', 'failed', 'cancelled'].includes(statusData.job_status)) {
        stopPolling();
        // Final tasks fetch after job is done
        const tasksData = await getJobTasks(jobId);
        setTasks(tasksData.tasks || []);
      } else {
         const tasksData = await getJobTasks(jobId);
         setTasks(tasksData.tasks || []);
      }
    } catch (err) {
      console.error('Error polling data:', err);
      setError('Failed to poll job data. Please refresh.');
      stopPolling();
    }
  }, [jobId, stopPolling]);

  const startPolling = useCallback(() => {
    if (jobId) {
      setIsPolling(true);
      pollData(); // Initial fetch
      pollingRef.current = window.setInterval(pollData, 3000);
    }
  }, [jobId, pollData]);

  useEffect(() => {
    if (jobId) {
      startPolling();
    }
    return () => {
      stopPolling();
    };
  }, [jobId, startPolling, stopPolling]);

  return { jobStatus, tasks, isPolling, error, setJobStatus };
};