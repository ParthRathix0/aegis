"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { formatEther, isAddress } from "viem";
import deployedContracts from "~~/contracts/deployedContracts";
import BatchStatus from "./BatchStatus";
import DepositForm from "./DepositForm";
import DisputeWidget from "./DisputeWidget";
import ClaimRewards from "./ClaimRewards";
import OracleMonitor from "./OracleMonitor";
import FullDemoFlow from "./FullDemoFlow";

// Contract ABI
const AEGIS_ABI = [
  {
    inputs: [],
    name: "getCurrentBatchInfo",
    outputs: [
      { name: "batchId", type: "uint256" },
      { name: "state", type: "uint8" },
      { name: "endBlock", type: "uint256" },
      { name: "buyVolume", type: "uint256" },
      { name: "sellVolume", type: "uint256" },
      { name: "settlementPrice", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "_amount", type: "uint256" },
      { name: "_side", type: "uint8" },
    ],
    name: "deposit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "dispute",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "_batchId", type: "uint256" }],
    name: "claim",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "_batchId", type: "uint256" },
      { name: "_user", type: "address" },
    ],
    name: "getUserOrder",
    outputs: [
      { name: "amount", type: "uint256" },
      { name: "side", type: "uint8" },
      { name: "claimed", type: "bool" },
      { name: "disputed", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "oracleCount",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
];

export default function AegisDashboard() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const [activeTab, setActiveTab] = useState<"deposit" | "dispute" | "claim" | "oracles" | "demo">("deposit");

  const contractConfig = useMemo(() => {
    const envAddressRaw = process.env.NEXT_PUBLIC_AEGIS_ADDRESS as string | undefined;
    const envAddress = envAddressRaw && isAddress(envAddressRaw) ? (envAddressRaw as `0x${string}`) : undefined;
    const chainConfig = (deployedContracts as any)?.[chainId]?.AegisV4;
    const localFallback = (deployedContracts as any)?.[31337]?.AegisV4;

    const address = (envAddress || chainConfig?.address || localFallback?.address || "0x0000000000000000000000000000000000000000") as `0x${string}`;
    const abi = chainConfig?.abi || localFallback?.abi || AEGIS_ABI;

    return { address, abi } as { address: `0x${string}`; abi: any };
  }, [chainId]);

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-white mb-4">⚔️ Aegis Protocol</h1>
          <p className="text-slate-300 text-lg mb-8">Fair, MEV-resistant batch settlement</p>
          <p className="text-slate-400">Please connect your wallet to continue</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-900 border-b border-slate-700 px-6 py-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-4xl font-bold text-white mb-2">⚔️ Aegis Protocol</h1>
          <p className="text-slate-300">Fair, MEV-resistant batch settlement with multi-oracle dynamic weighting</p>
          {address && (
            <p className="text-slate-400 text-sm mt-4">Connected: {address.slice(0, 6)}...{address.slice(-4)}</p>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Batch Status */}
        <BatchStatus contractAddress={contractConfig.address} abi={contractConfig.abi} />

        {/* Tabs Navigation */}
        <div className="flex gap-2 mb-6 border-b border-slate-700">
          {["deposit", "dispute", "claim", "oracles", "demo"].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={`px-6 py-3 font-semibold transition ${
                activeTab === tab
                  ? "text-white border-b-2 border-blue-500"
                  : "text-slate-400 hover:text-slate-300"
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            {activeTab === "deposit" && <DepositForm contractAddress={contractConfig.address} abi={contractConfig.abi} />}
            {activeTab === "dispute" && <DisputeWidget contractAddress={contractConfig.address} abi={contractConfig.abi} />}
            {activeTab === "claim" && <ClaimRewards contractAddress={contractConfig.address} abi={contractConfig.abi} />}
            {activeTab === "oracles" && <OracleMonitor contractAddress={contractConfig.address} abi={contractConfig.abi} />}
            {activeTab === "demo" && <FullDemoFlow contractAddress={contractConfig.address} abi={contractConfig.abi} />}
          </div>

          {/* Sidebar Info */}
          <div className="space-y-4">
            <div className="bg-gradient-to-br from-blue-900 to-blue-800 border border-blue-700 rounded-lg p-4">
              <h4 className="text-white font-bold mb-3">📊 How It Works</h4>
              <ul className="text-blue-100 text-sm space-y-2">
                <li>1. <strong>OPEN:</strong> Deposit BUY/SELL orders</li>
                <li>2. <strong>ACCUMULATING:</strong> Collect oracle prices</li>
                <li>3. <strong>DISPUTING:</strong> Challenge settlement price</li>
                <li>4. <strong>SETTLING:</strong> Execute fills & claim</li>
              </ul>
            </div>

            <div className="bg-gradient-to-br from-purple-900 to-purple-800 border border-purple-700 rounded-lg p-4">
              <h4 className="text-white font-bold mb-3">🛡️ Hydra Defense</h4>
              <p className="text-purple-100 text-sm">Multiple oracle sources with dynamic weighting prevent MEV and ensure fair pricing.</p>
            </div>

            <div className="bg-gradient-to-br from-green-900 to-green-800 border border-green-700 rounded-lg p-4">
              <h4 className="text-white font-bold mb-3">✓ Benefits</h4>
              <ul className="text-green-100 text-sm space-y-1">
                <li>• No frontrunning</li>
                <li>• Fair price discovery</li>
                <li>• Community-driven</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}