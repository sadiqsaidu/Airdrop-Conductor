import React, { useState, useEffect } from 'react';
import { Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';

interface Campaign {
  id: string;
  name: string;
  status: string;
  mode: string;
  totalRecipients: number;
  totalConfirmed: number;
  totalFailed: number;
  totalSOLSpent: number;
  recipients: Recipient[];
}

interface Recipient {
  id: string;
  address: string;
  amount: number;
  status: string;
  txSignature: string | null;
  feesPaid: number | null;
}

export const CampaignDashboard: React.FC<{ campaignId: string }> = ({ campaignId }) => {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCampaign = async () => {
      const response = await fetch(`/api/campaigns/${campaignId}`);
      const data = await response.json();
      setCampaign(data.campaign);
      setLoading(false);
    };

    fetchCampaign();
    const interval = setInterval(fetchCampaign, 2000); // Poll every 2s
    return () => clearInterval(interval);
  }, [campaignId]);

  if (loading || !campaign) {
    return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;
  }

  const progress = (campaign.totalConfirmed / campaign.totalRecipients) * 100;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <h1 className="text-2xl font-bold mb-2">{campaign.name}</h1>
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full">
            {campaign.mode === 'high-assurance' ? '🚀 High Assurance' : '💰 Cost Saver'}
          </span>
          <span className="px-3 py-1 bg-gray-100 rounded-full capitalize">
            {campaign.status}
          </span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="mb-2 flex justify-between text-sm">
          <span className="font-medium">Overall Progress</span>
          <span className="text-gray-600">{progress.toFixed(1)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-4">
          <div
            className="bg-green-500 h-4 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          icon={<Clock className="text-blue-500" />}
          label="Total"
          value={campaign.totalRecipients}
        />
        <StatCard
          icon={<CheckCircle2 className="text-green-500" />}
          label="Confirmed"
          value={campaign.totalConfirmed}
        />
        <StatCard
          icon={<XCircle className="text-red-500" />}
          label="Failed"
          value={campaign.totalFailed}
        />
        <StatCard
          icon={<span className="text-2xl">◎</span>}
          label="SOL Spent"
          value={campaign.totalSOLSpent.toFixed(6)}
        />
      </div>

      {/* Transaction Feed */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b">
          <h2 className="text-lg font-semibold">Recent Transactions</h2>
        </div>
        <div className="divide-y">
          {campaign.recipients.map((recipient) => (
            <TransactionRow key={recipient.id} recipient={recipient} />
          ))}
        </div>
      </div>
    </div>
  );
};

const StatCard: React.FC<{ icon: React.ReactNode; label: string; value: string | number }> = ({
  icon,
  label,
  value,
}) => (
  <div className="bg-white rounded-lg shadow p-6">
    <div className="flex items-center justify-between mb-2">
      {icon}
      <span className="text-2xl font-bold">{value}</span>
    </div>
    <p className="text-sm text-gray-600">{label}</p>
  </div>
);

const TransactionRow: React.FC<{ recipient: Recipient }> = ({ recipient }) => {
  const statusConfig = {
    confirmed: { color: 'text-green-600', icon: <CheckCircle2 className="w-4 h-4" /> },
    failed: { color: 'text-red-600', icon: <XCircle className="w-4 h-4" /> },
    sent: { color: 'text-blue-600', icon: <Loader2 className="w-4 h-4 animate-spin" /> },
    pending: { color: 'text-gray-400', icon: <Clock className="w-4 h-4" /> },
  };

  const config = statusConfig[recipient.status as keyof typeof statusConfig];

  return (
    <div className="p-4 hover:bg-gray-50 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={config.color}>{config.icon}</div>
          <div>
            <p className="font-mono text-sm">
              {recipient.address.slice(0, 8)}...{recipient.address.slice(-8)}
            </p>
            <p className="text-xs text-gray-500">{recipient.amount} tokens</p>
          </div>
        </div>
        <div className="text-right">
          {recipient.txSignature && (
            
              href={`https://solscan.io/tx/${recipient.txSignature}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline"
            >
              View Tx
            </a>
          )}
          {recipient.feesPaid && (
            <p className="text-xs text-gray-500 mt-1">
              Fee: {recipient.feesPaid.toFixed(6)} SOL
            </p>
          )}
        </div>
      </div>
    </div>
  );
};