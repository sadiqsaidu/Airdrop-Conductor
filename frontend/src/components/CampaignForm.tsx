import React, { useState } from "react";
import { createCampaign } from "../services/api";
import type { CampaignFormData } from "../types";

interface Props {
  onCreated: () => void;
}

export default function CampaignForm({ onCreated }: Props) {
  const [form, setForm] = useState<CampaignFormData>({
    name: "",
    tokenMint: "",
    tokenDecimals: "9",
    sourceTokenAccount: "",
    authorityWallet: "",
    mode: "cost-saver",
    batchSize: "20",
    maxRetries: "3",
    file: null,
  });

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, file: e.target.files?.[0] || null }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      await createCampaign(form);
      setMessage("✅ Campaign created successfully!");
      onCreated();
    } catch (err: any) {
      setMessage("❌ Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-gray-900 p-6 rounded-xl max-w-xl mx-auto space-y-4"
    >
      <h2 className="text-2xl font-bold mb-4">Create New Campaign</h2>

      {[
        { label: "Campaign Name", name: "name" },
        { label: "Token Mint", name: "tokenMint" },
        { label: "Token Decimals", name: "tokenDecimals" },
        { label: "Source Token Account", name: "sourceTokenAccount" },
        { label: "Authority Wallet", name: "authorityWallet" },
      ].map((field) => (
        <div key={field.name}>
          <label className="block text-sm font-medium mb-1">
            {field.label}
          </label>
          <input
            type="text"
            name={field.name}
            value={(form as any)[field.name]}
            onChange={handleChange}
            required
            className="w-full p-2 rounded bg-gray-800 border border-gray-700"
          />
        </div>
      ))}

      <div>
        <label className="block text-sm font-medium mb-1">Mode</label>
        <select
          name="mode"
          value={form.mode}
          onChange={handleChange}
          className="w-full p-2 rounded bg-gray-800 border border-gray-700"
        >
          <option value="cost-saver">Cost Saver</option>
          <option value="high-assurance">High Assurance</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Recipients CSV</label>
        <input
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          required
          className="w-full"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg mt-4 w-full"
      >
        {loading ? "Creating..." : "Create Campaign"}
      </button>

      {message && <p className="mt-3 text-center">{message}</p>}
    </form>
  );
}
