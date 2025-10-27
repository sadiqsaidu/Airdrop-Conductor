import { useEffect, useState } from "react";
import { fetchCampaigns } from "../services/api";
import type { Campaign } from "../types";

interface Props {
  onSelectCampaign: (campaign: Campaign) => void;
}

export default function CampaignList({ onSelectCampaign }: Props) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const data = await fetchCampaigns();
        setCampaigns(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) return <p>Loading campaigns...</p>;
  if (error) return <p className="text-red-500">{error}</p>;
  if (campaigns.length === 0) return <p>No campaigns found.</p>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {campaigns.map((c) => (
        <div
          key={c.id}
          onClick={() => onSelectCampaign(c)}
          className="bg-gray-800 rounded-xl p-4 cursor-pointer hover:bg-gray-700 transition"
        >
          <h2 className="text-lg font-semibold mb-2">{c.name}</h2>
          <p className="text-sm text-gray-400">Token Mint: {c.tokenMint}</p>
          <p className="text-sm">Recipients: {c.totalRecipients}</p>
          <p className="text-sm">Status: {c.status}</p>
        </div>
      ))}
    </div>
  );
}
