import React, { useState, useCallback } from 'react';
import { Upload, Shield, Zap, AlertCircle, Loader2, FileText, Download, ArrowLeft } from 'lucide-react';
import { useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import { View } from '../../App';
import { createJob, getUnsignedTransactions, submitSignedTransactions } from '../../services/apiService';

interface UploadViewProps {
  setActiveView: (view: View) => void;
  setJobId: (jobId: string) => void;
}

const UploadView: React.FC<UploadViewProps> = ({ setActiveView, setJobId }) => {
  const { publicKey, signAllTransactions } = useWallet();
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [tokenMint, setTokenMint] = useState('');
  const [mode, setMode] = useState<'high-assurance' | 'cost-saver'>('high-assurance');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [progress, setProgress] = useState('');

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.csv')) {
        setCsvFile(file);
        setError('');
      } else {
        setError('Please upload a valid CSV file.');
      }
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.name.endsWith('.csv')) {
        setCsvFile(file);
        setError('');
      } else {
        setError('Please upload a valid CSV file.');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!publicKey) {
      setError('Please connect your wallet first.');
      return;
    }

    if (!csvFile || !tokenMint) {
      setError('Please fill all fields and upload a CSV file.');
      return;
    }

    if (!signAllTransactions) {
      setError('Your wallet does not support signing multiple transactions.');
      return;
    }

    setError('');
    setIsSubmitting(true);

    try {
      // Step 1: Create job
      setProgress('Creating job...');
      const formData = new FormData();
      formData.append('csvFile', csvFile);
      formData.append('tokenMintAddress', tokenMint);
      formData.append('distributorAddress', publicKey.toBase58());
      formData.append('mode', mode);

      const jobData = await createJob(formData);
      const currentJobId = jobData.job_id;
      setJobId(currentJobId);

      // Step 2: Get unsigned transactions
      setProgress('Preparing transactions...');
      const { transactions } = await getUnsignedTransactions(currentJobId);

      if (transactions.length === 0) {
        setProgress('No transactions to process.');
        setActiveView('dashboard');
        return;
      }

      // Step 3: Deserialize and sign transactions
      setProgress(`Please sign ${transactions.length} transactions in your wallet...`);
      const unsignedTxs = transactions.map((item: any) => {
        const txBuffer = Buffer.from(item.transaction, 'base64');
        return VersionedTransaction.deserialize(txBuffer);
      });

      const signedTxs = await signAllTransactions(unsignedTxs);

      // Step 4: Serialize signed transactions
      setProgress('Submitting transactions...');
      const signedTransactionsData = signedTxs.map((tx, index) => ({
        task_id: transactions[index].task_id,
        transaction: Buffer.from(tx.serialize()).toString('base64'),
      }));

      // Step 5: Submit to backend
      await submitSignedTransactions(currentJobId, signedTransactionsData);

      setProgress('Success! Redirecting to dashboard...');
      setTimeout(() => {
        setActiveView('dashboard');
      }, 1000);

    } catch (err: any) {
      console.error('Error:', err);
      setError(err.message || 'An error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
      setProgress('');
    }
  };

  const downloadTemplate = () => {
    window.open('http://localhost:4000/api/csv-template', '_blank');
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-24 relative z-10">
      <button
        onClick={() => setActiveView('home')}
        className="text-zinc-400 hover:text-zinc-100 mb-10 flex items-center gap-2 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="border border-white/10 rounded-2xl p-10 bg-white/5 backdrop-blur-sm">
        <h2 className="text-3xl font-light mb-2 tracking-tight">Start Distribution</h2>
        <p className="text-zinc-400 mb-10 text-sm">Upload your CSV and configure distribution settings</p>

        {!publicKey && (
          <div className="mb-8 p-4 bg-amber-950/30 border border-amber-900/30 rounded-xl flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-300">
              Please connect your wallet to continue. Click "Select Wallet" in the header.
            </div>
          </div>
        )}

        {error && (
          <div className="mb-8 p-4 bg-red-950/30 border border-red-900/30 rounded-xl flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-300">{error}</div>
          </div>
        )}

        {progress && (
          <div className="mb-8 p-4 bg-blue-950/30 border border-blue-900/30 rounded-xl flex items-start gap-3">
            <Loader2 className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5 animate-spin" />
            <div className="text-sm text-blue-300">{progress}</div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">
          <div>
            <label className="block text-sm font-medium mb-3 text-zinc-300">Recipient List (CSV)</label>
            <div
              onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-10 text-center transition-all ${
                dragActive ? 'border-white/40 bg-white/10' : 'border-white/20 hover:border-white/30 bg-white/5'
              }`}
            >
              <input type="file" accept=".csv" onChange={handleFileChange} className="hidden" id="csv-upload" />
              <label htmlFor="csv-upload" className="cursor-pointer flex flex-col items-center justify-center">
                {csvFile ? (
                  <div className="flex flex-col items-center justify-center gap-2">
                    <FileText className="w-10 h-10 text-zinc-300" />
                    <span className="font-medium text-zinc-100">{csvFile.name}</span>
                    <span className="text-sm text-zinc-500">{(csvFile.size / 1024).toFixed(2)} KB</span>
                    <span className="mt-2 text-xs text-zinc-500">Click to change file</span>
                  </div>
                ) : (
                  <>
                    <Upload className="w-10 h-10 mx-auto mb-4 text-zinc-500" />
                    <p className="text-base mb-2 text-zinc-300">Drop CSV file here or click to upload</p>
                    <p className="text-sm text-zinc-500">Format: address, amount</p>
                  </>
                )}
              </label>
            </div>
            <button type="button" onClick={downloadTemplate} className="mt-3 text-sm text-zinc-400 hover:text-zinc-100 flex items-center gap-2 transition-colors">
              <Download className="w-4 h-4" />
              Download CSV Template
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium mb-3 text-zinc-300">Token Mint Address</label>
            <input type="text" value={tokenMint} onChange={(e) => setTokenMint(e.target.value)} placeholder="Enter SPL token mint address"
              className="w-full px-4 py-3.5 bg-black/40 border border-white/20 rounded-xl focus:outline-none focus:border-white/40 font-mono text-sm text-zinc-100 placeholder-zinc-600" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-4 text-zinc-300">Distribution Mode</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button type="button" onClick={() => setMode('high-assurance')}
                className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                  mode === 'high-assurance' ? 'border-white/40 bg-white/20' : 'border-white/20 hover:border-white/30 bg-white/5'
                }`}>
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-zinc-300" />
                  <p className="font-medium">High Assurance</p>
                </div>
                <p className="text-xs text-zinc-500 leading-relaxed mt-1">Maximum reliability</p>
              </button>
              <button type="button" onClick={() => setMode('cost-saver')}
                className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                  mode === 'cost-saver' ? 'border-white/40 bg-white/20' : 'border-white/20 hover:border-white/30 bg-white/5'
                }`}>
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-zinc-300" />
                  <p className="font-medium">Cost Saver</p>
                </div>
                <p className="text-xs text-zinc-500 leading-relaxed mt-1">Budget-friendly</p>
              </button>
            </div>
          </div>

          <button type="submit" disabled={isSubmitting || !csvFile || !publicKey}
            className="w-full py-4 bg-gradient-to-br from-zinc-200 to-white text-zinc-900 rounded-xl font-medium flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-white/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.01]">
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Processing...
              </>
            ) : (
              'Start Distribution'
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default UploadView;