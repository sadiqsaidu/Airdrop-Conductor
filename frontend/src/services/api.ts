import type { Campaign, CampaignFormData } from "../types";

const API_BASE = "http://localhost:3001/api";

// --- REAL API CALLS ---

export const fetchCampaigns = async (): Promise<Campaign[]> => {
  const response = await fetch(`${API_BASE}/campaigns`);
  if (!response.ok) throw new Error("Failed to fetch campaigns");
  const data = await response.json();
  return data.campaigns;
};

export const fetchCampaignDetails = async (id: string): Promise<Campaign> => {
  const response = await fetch(`${API_BASE}/campaigns/${id}`);
  if (!response.ok) throw new Error("Failed to fetch campaign details");
  const data = await response.json();
  return data.campaign;
};

export const createCampaign = async (
  formData: CampaignFormData
): Promise<Campaign> => {
  const formPayload = new FormData();
  Object.entries(formData).forEach(([key, value]) => {
    if (key === "file" && value) formPayload.append("file", value);
    else if (value !== null) formPayload.append(key, String(value));
  });

  const response = await fetch(`${API_BASE}/campaigns`, {
    method: "POST",
    body: formPayload,
  });

  if (!response.ok) throw new Error("Failed to create campaign");
  const data = await response.json();
  return data.campaign;
};

export const executeCampaign = async (id: string): Promise<void> => {
  const response = await fetch(`${API_BASE}/campaigns/${id}/execute`, {
    method: "POST",
  });
  if (!response.ok) throw new Error("Failed to execute campaign");
};
