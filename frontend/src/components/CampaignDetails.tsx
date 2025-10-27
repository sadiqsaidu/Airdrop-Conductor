import { useEffect, useState } from "react";
import { fetchCampaignDetails, executeCampaign } from "../services/api";
import type { Campaign } from "../types";

interface Props {
  campaign: Campaign;
  onBack: () => void;
}

export default function CampaignDetails({ campaign, onBack }: Props) {
  const [details, setDetails] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchCampaignDetails(campaign.id);
        setDetails(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [campaign.id]);

  const handleExecute = async () => {
    setExecuting(true);
    try {
      await executeCampaign(campaign.id);
      alert("✅ Campaign execution started!");
    } catch (err: any) {
      alert("❌ Error: " + err.message);
    } finally {
      setExecuting(false);
    }
  };

  if (loading) return <p>Loading campaign details...</p>;
  if (!details) return <p>Campaign not found.</p>;

  return (
    <div className="max-w-2xl mx-auto bg-gray-900 p-6 rounded-xl">
      <button
        onClick={onBack}
        className="text-blue-400 hover:text-blue-300 mb-4"
      >
        ← Back
      </button>

      <h2 className="text-2xl font-bold mb-2">{details.name}</h2>
      <p className="text-sm text-gray-400 mb-2">Mint: {details.tokenMint}</p>
      <p>Recipients: {details.totalRecipients}</p>
      <p>Status: {details.status}</p>

      <button
        onClick={handleExecute}
        disabled={executing}
        className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg mt-4"
      >
        {executing ? "Executing..." : "Start Execution"}
      </button>
    </div>
  );
}
