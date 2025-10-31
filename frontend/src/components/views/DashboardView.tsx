import React from 'react';
import { CheckCircle, XCircle, Clock, Loader2, ArrowLeft } from 'lucide-react';
import { useJobPolling } from '../../hooks/useJobPolling';
import { View } from '../../App';
import { Task } from '../../types';

interface DashboardViewProps {
  setActiveView: (view: View) => void;
  jobId: string | null;
}

const statusIcons: { [key: string]: React.ElementType } = {
  success: CheckCircle,
  processing: Loader2,
  failed: XCircle,
  pending: Clock,
};

const TaskRow: React.FC<{ task: Task }> = ({ task }) => {
  const Icon = statusIcons[task.status] || Clock;
  return (
    <tr className="hover:bg-white/5 transition-colors">
      <td className="px-8 py-5 text-sm font-mono text-zinc-300 whitespace-nowrap">
        {`${task.recipient_address.slice(0, 8)}...${task.recipient_address.slice(-8)}`}
      </td>
      <td className="px-8 py-5 text-sm text-zinc-300 whitespace-nowrap">{parseInt(task.amount, 10).toLocaleString()}</td>
      <td className="px-8 py-5">
        <span className={`inline-flex items-center capitalize gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${
          task.status === 'success' ? 'bg-gradient-to-br from-zinc-200 to-white text-zinc-900' :
          task.status === 'processing' ? 'bg-white/10 text-zinc-200 border border-white/20' :
          task.status === 'failed' ? 'bg-red-950/30 text-red-300 border border-red-900/30' :
          'bg-zinc-900/50 text-zinc-500 border border-white/10'
        }`}>
          <Icon className={`w-3.5 h-3.5 ${task.status === 'processing' ? 'animate-spin' : ''}`} />
          {task.status}
        </span>
      </td>
      <td className="px-8 py-5 text-sm font-mono">
        {task.tx_signature ? (
          <a
            href={`https://explorer.solana.com/tx/${task.tx_signature}?cluster=devnet`}
            target="_blank" rel="noopener noreferrer"
            className="text-zinc-400 hover:text-zinc-100 underline decoration-zinc-700 hover:decoration-zinc-400 transition-colors"
          >
            {`${task.tx_signature.slice(0, 8)}...`}
          </a>
        ) : <span className="text-zinc-700">-</span>}
      </td>
    </tr>
  );
};

const DashboardView: React.FC<DashboardViewProps> = ({ setActiveView, jobId }) => {
  const { jobStatus, tasks } = useJobPolling(jobId);

  if (!jobId) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-24 relative z-10">
        <div className="text-center py-20">
          <p className="text-zinc-400 mb-4">No job selected. Please start a new distribution.</p>
          <button 
            onClick={() => setActiveView('upload')} 
            className="px-6 py-3 bg-gradient-to-br from-zinc-200 to-white text-zinc-900 rounded-lg font-medium hover:shadow-lg hover:shadow-white/20 transition-all"
          >
            Go to Upload
          </button>
        </div>
      </div>
    );
  }

  const progress = jobStatus ? Math.round(((jobStatus.success + jobStatus.failed) / jobStatus.total) * 100) : 0;
  
  return (
    <div className="max-w-7xl mx-auto px-6 py-24 relative z-10">
      <button onClick={() => setActiveView('home')} className="text-zinc-400 hover:text-zinc-100 mb-10 flex items-center gap-2 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      {!jobStatus ? (
        <div className="text-center py-20">
          <Loader2 className="w-8 h-8 mx-auto animate-spin mb-4" />
          <p>Loading job details...</p>
        </div>
      ) : (
        <>
          <div className="border border-white/10 rounded-2xl p-10 mb-6 bg-white/5 backdrop-blur-sm">
            <div className="flex flex-col sm:flex-row items-start justify-between mb-8 gap-4">
              <div>
                <h2 className="text-3xl font-light mb-2 tracking-tight">Distribution Dashboard</h2>
                <p className="text-zinc-400 text-sm font-mono">Job ID: {jobId}</p>
                {jobStatus.distributor_address && (
                  <p className="text-zinc-500 text-xs font-mono mt-1">
                    From: {jobStatus.distributor_address.slice(0, 8)}...{jobStatus.distributor_address.slice(-8)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div className={`px-4 py-2 rounded-lg font-medium text-sm capitalize ${
                  jobStatus.job_status === 'completed' ? 'bg-gradient-to-br from-zinc-200 to-white text-zinc-900' :
                  jobStatus.job_status === 'running' ? 'bg-white/10 text-zinc-100 border border-white/20' :
                  jobStatus.job_status === 'failed' ? 'bg-red-950/30 text-red-300 border border-red-900/30' :
                  jobStatus.job_status === 'cancelled' ? 'bg-zinc-900/50 text-zinc-400 border border-white/10' :
                  'bg-zinc-900/50 text-zinc-500 border border-white/10'
                }`}>
                  {jobStatus.job_status}
                </div>
              </div>
            </div>

            <div className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-zinc-400">Progress</span>
                <span className="text-sm font-medium text-zinc-300">{progress}%</span>
              </div>
              <div className="h-2 bg-black/40 rounded-full overflow-hidden border border-white/10">
                <div
                  className="h-full bg-gradient-to-r from-zinc-300 to-white transition-all duration-500"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="p-5 border border-white/10 rounded-xl bg-white/5">
                <div className="text-2xl font-light mb-1 text-zinc-100">{jobStatus.total}</div>
                <div className="text-sm text-zinc-500">Total Tasks</div>
              </div>
              <div className="p-5 border border-white/20 rounded-xl bg-white/10">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle className="w-5 h-5 text-zinc-200" />
                  <div className="text-2xl font-light text-zinc-100">{jobStatus.success}</div>
                </div>
                <div className="text-sm text-zinc-400">Successful</div>
              </div>
              <div className="p-5 border border-white/10 rounded-xl bg-white/5">
                <div className="flex items-center gap-2 mb-1">
                  <XCircle className="w-5 h-5 text-zinc-500" />
                  <div className="text-2xl font-light text-zinc-400">{jobStatus.failed}</div>
                </div>
                <div className="text-sm text-zinc-600">Failed</div>
              </div>
              <div className="p-5 border border-white/20 rounded-xl bg-white/10">
                <div className="flex items-center gap-2 mb-1">
                  <Loader2 className="w-5 h-5 text-zinc-200 animate-spin" />
                  <div className="text-2xl font-light text-zinc-100">{jobStatus.processing}</div>
                </div>
                <div className="text-sm text-zinc-400">Processing</div>
              </div>
              <div className="p-5 border border-white/10 rounded-xl bg-white/5">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="w-5 h-5 text-zinc-500" />
                  <div className="text-2xl font-light text-zinc-400">{jobStatus.pending}</div>
                </div>
                <div className="text-sm text-zinc-600">Pending</div>
              </div>
            </div>
          </div>

          <div className="border border-white/10 rounded-2xl overflow-hidden bg-white/5 backdrop-blur-sm">
            <div className="p-8 border-b border-white/10">
              <h3 className="text-xl font-light tracking-tight">Transaction Details</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead className="border-b border-white/10">
                  <tr>
                    <th className="px-8 py-4 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Recipient</th>
                    <th className="px-8 py-4 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Amount</th>
                    <th className="px-8 py-4 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                    <th className="px-8 py-4 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Signature</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {tasks.length > 0 ? tasks.map((task) => (
                    <TaskRow key={task.task_id} task={task} />
                  )) : (
                    <tr>
                      <td colSpan={4} className="text-center py-10 text-zinc-500">
                        {jobStatus.job_status === 'running' || jobStatus.job_status === 'pending' ? 'Waiting for transactions...' : 'No transactions found for this job.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default DashboardView;