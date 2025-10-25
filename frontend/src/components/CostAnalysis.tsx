import React from 'react';
import { TrendingDown, DollarSign, Zap } from 'lucide-react';

interface CostAnalysisProps {
  campaignId: string;
  totalSOLSpent: number;
  totalConfirmed: number;
  mode: 'cost-saver' | 'high-assurance';
}

export const CostAnalysis: React.FC<CostAnalysisProps> = ({
  totalSOLSpent,
  totalConfirmed,
  mode,
}) => {
  // Naive script estimate: 0.00005 SOL per transaction (standard priority fee)
  const naiveEstimate = totalConfirmed * 0.00005;
  
  // Calculate savings or additional cost
  const difference = naiveEstimate - totalSOLSpent;
  const savingsPercentage = ((difference / naiveEstimate) * 100).toFixed(1);
  
  const avgCostPerTx = totalConfirmed > 0 ? totalSOLSpent / totalConfirmed : 0;

  const isSaving = difference > 0;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <DollarSign className="w-5 h-5 text-green-600" />
        Cost Analysis
      </h2>

      <div className="space-y-4">
        {/* Actual Cost */}
        <div className="flex justify-between items-center py-2 border-b">
          <span className="text-gray-600">Actual Cost (Gateway)</span>
          <span className="font-semibold">◎ {totalSOLSpent.toFixed(6)}</span>
        </div>

        {/* Naive Estimate */}
        <div className="flex justify-between items-center py-2 border-b">
          <span className="text-gray-600">Naive Script Estimate</span>
          <span className="font-semibold text-gray-500">◎ {naiveEstimate.toFixed(6)}</span>
        </div>

        {/* Savings */}
        <div className={`flex justify-between items-center py-3 rounded-lg px-4 ${
          isSaving ? 'bg-green-50' : 'bg-orange-50'
        }`}>
          <div className="flex items-center gap-2">
            {isSaving ? (
              <TrendingDown className="w-5 h-5 text-green-600" />
            ) : (
              <Zap className="w-5 h-5 text-orange-600" />
            )}
            <span className={`font-semibold ${
              isSaving ? 'text-green-900' : 'text-orange-900'
            }`}>
              {isSaving ? 'Cost Savings' : 'Premium for Reliability'}
            </span>
          </div>
          <span className={`font-bold text-lg ${
            isSaving ? 'text-green-600' : 'text-orange-600'
          }`}>
            {isSaving ? '-' : '+'}{Math.abs(difference).toFixed(6)} SOL
            <span className="text-sm ml-2">({Math.abs(parseFloat(savingsPercentage))}%)</span>
          </span>
        </div>

        {/* Average Cost */}
        <div className="flex justify-between items-center py-2">
          <span className="text-gray-600">Avg Cost per Transaction</span>
          <span className="font-semibold">◎ {avgCostPerTx.toFixed(6)}</span>
        </div>

        {/* Mode Badge */}
        <div className="pt-4 border-t">
          <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full ${
            mode === 'high-assurance' 
              ? 'bg-blue-100 text-blue-700' 
              : 'bg-green-100 text-green-700'
          }`}>
            {mode === 'high-assurance' ? '🚀' : '💰'}
            <span className="font-medium capitalize">{mode.replace('-', ' ')} Mode</span>
          </div>
        </div>

        {/* Explanation */}
        <div className="text-xs text-gray-500 pt-2">
          {mode === 'cost-saver' ? (
            <p>
              <strong>Cost-Saver Mode:</strong> Gateway dynamically adjusts priority fees to the 
              25th percentile, resulting in lower costs for non-urgent distributions. 
              {isSaving && ' Your campaign saved money compared to fixed-fee scripts!'}
            </p>
          ) : (
            <p>
              <strong>High-Assurance Mode:</strong> Gateway uses hybrid RPC + Jito routing with 
              90th percentile priority fees for maximum reliability during network congestion. 
              The premium ensures your critical transactions land successfully.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};