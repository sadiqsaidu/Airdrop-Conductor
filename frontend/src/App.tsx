import { useState } from "react";
import CampaignList from "./components/CampaignList";
import CampaignForm from "./components/CampaignForm";
import CampaignDetails from "./components/CampaignDetails";
import type { Campaign } from "./types";

export default function App() {
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(
    null
  );
  const [view, setView] = useState<"list" | "create" | "details">("list");

  const handleSelectCampaign = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setView("details");
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <header className="mb-8 flex justify-between items-center">
        <h1 className="text-3xl font-bold text-white">Airdrop Conductor</h1>
        <div>
          {view !== "create" ? (
            <button
              onClick={() => setView("create")}
              className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg"
            >
              + New Campaign
            </button>
          ) : (
            <button
              onClick={() => setView("list")}
              className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg"
            >
              ← Back to List
            </button>
          )}
        </div>
      </header>

      {view === "list" && (
        <CampaignList onSelectCampaign={handleSelectCampaign} />
      )}
      {view === "create" && (
        <CampaignForm onCreated={() => setView("list")} />
      )}
      {view === "details" && selectedCampaign && (
        <CampaignDetails
          campaign={selectedCampaign}
          onBack={() => setView("list")}
        />
      )}
    </div>
  );
}
