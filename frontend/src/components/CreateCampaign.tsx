import React, { useState } from 'react';
import { Upload, AlertCircle, CheckCircle } from 'lucide-react';

interface CampaignFormData {
  name: string;
  tokenMint: string;
  tokenDecimals: string;
  sourceTokenAccount: string;
  authorityWallet: string;
  mode: 'cost-saver' | 'high-assurance';
  batchSize: string;
  maxRetries: string;
  file: File | null;
}

export const CreateCampaign: React.FC = () => {
  const [formData, setFormData] = useState<CampaignFormData>({
    name: '',
    tokenMint: '',
    tokenDecimals: '9',
    sourceTokenAccount: '',
    authorityWallet: '',
    mode: 'cost-saver',
    batchSize: '20',
    maxRetries: '3',
    file: null,
  });

  const [preview, setPreview] = useState<{ address: string; amount: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFormData({ ...formData, file });

    // Parse and preview CSV
    const text = await file.text();
    const lines = text.split('\n').filter(Boolean);
    
    const parsed = lines.slice(1, 11).map(line => {
      const values = line.split(',');
      return {
        address: values[0]?.trim() || '',
        amount: values[1]?.trim() || '0',
      };
    });

    setPreview(parsed);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const formDataToSend = new FormData();
      Object.entries(formData).forEach(([key, value]) => {
        if (value !== null) {
          formDataToSend.append(key, value);
        }
      });

      const response = await fetch('/api/campaigns', {
        method: 'POST',
        body: formDataToSend,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create campaign');
      }

      const data = await response.json();
      setSuccess(true);
      
      // Redirect to dashboard after 2s
      setTimeout(() => {
        window.location.href = `/campaigns/${data.campaign.id}`;
      }, 2000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-green-900 mb-2">
            Campaign Created Successfully!
          </h2>
          <p className="text-green-700">Redirecting to dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg p-8">
        <h1 className="text-3xl font-bold mb-6">Create Airdrop Campaign</h1>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
            <p className="text-red-700">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Campaign Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Campaign Name
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., Community Rewards Q1 2025"
            />
          </div>

          {/* Token Configuration */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Token Mint Address
              </label>
              <input
                type="text"
                required
                value={formData.tokenMint}
                onChange={(e) => setFormData({ ...formData, tokenMint: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                placeholder="So11111111111111111111111111111111111112"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Token Decimals
              </label>
              <input
                type="number"
                required
                value={formData.tokenDecimals}
                onChange={(e) => setFormData({ ...formData, tokenDecimals: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="9"
              />
            </div>
          </div>

          {/* Source Account */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Source Token Account
            </label>
            <input
              type="text"
              required
              value={formData.sourceTokenAccount}
              onChange={(e) => setFormData({ ...formData, sourceTokenAccount: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
              placeholder="Your token account holding the tokens to distribute"
            />
          </div>

          {/* Delivery Mode */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Delivery Mode
            </label>
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setFormData({ ...formData, mode: 'cost-saver' })}
                className={`p-4 border-2 rounded-lg text-left transition-all ${
                  formData.mode === 'cost-saver'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">💰</span>
                  <h3 className="font-semibold">Cost-Saver Mode</h3>
                </div>
                <p className="text-sm text-gray-600">
                  Optimized for lowest fees. Uses standard RPC with low priority fees.
                  Best for non-urgent distributions.
                </p>
                <div className="mt-2 text-xs text-gray-500">
                  • Low priority fees (25th percentile)
                  <br />• Standard RPC routing only
                </div>
              </button>

              <button
                type="button"
                onClick={() => setFormData({ ...formData, mode: 'high-assurance' })}
                className={`p-4 border-2 rounded-lg text-left transition-all ${
                  formData.mode === 'high-assurance'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">🚀</span>
                  <h3 className="font-semibold">High-Assurance Mode</h3>
                </div>
                <p className="text-sm text-gray-600">
                  Maximum reliability. Uses hybrid RPC + Jito routing with higher fees.
                  Best for time-sensitive campaigns.
                </p>
                <div className="mt-2 text-xs text-gray-500">
                  • High priority fees (90th percentile)
                  <br />• Hybrid RPC + Jito Bundle routing
                </div>
              </button>
            </div>
          </div>

          {/* Advanced Settings */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Batch Size
              </label>
              <input
                type="number"
                value={formData.batchSize}
                onChange={(e) => setFormData({ ...formData, batchSize: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                min="1"
                max="100"
              />
              <p className="text-xs text-gray-500 mt-1">
                Number of transactions sent simultaneously
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Max Retry Attempts
              </label>
              <input
                type="number"
                value={formData.maxRetries}
                onChange={(e) => setFormData({ ...formData, maxRetries: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                min="0"
                max="10"
              />
              <p className="text-xs text-gray-500 mt-1">
                Retries for failed transactions with exponential backoff
              </p>
            </div>
          </div>

          {/* File Upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Upload Recipients (CSV)
            </label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
              <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                required
                className="hidden"
                id="file-upload"
              />
              <label htmlFor="file-upload" className="cursor-pointer">
                <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-sm text-gray-600 mb-2">
                  {formData.file ? formData.file.name : 'Click to upload CSV file'}
                </p>
                <p className="text-xs text-gray-500">
                  Format: address, amount (one recipient per line)
                </p>
              </label>
            </div>
          </div>

          {/* CSV Preview */}
          {preview.length > 0 && (
            <div className="border border-gray-200 rounded-lg p-4">
              <h3 className="font-semibold mb-3">Preview (first 10 rows)</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left">Address</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {preview.map((row, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2 font-mono text-xs">
                          {row.address.slice(0, 8)}...{row.address.slice(-8)}
                        </td>
                        <td className="px-4 py-2 text-right">{row.amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Creating Campaign...
              </>
            ) : (
              'Create Campaign'
            )}
          </button>
        </form>
      </div>
    </div>
  );
};