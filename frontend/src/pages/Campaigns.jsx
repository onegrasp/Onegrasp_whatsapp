import { useState, useEffect } from "react";
import {
  Megaphone,
  TrendingUp,
  CheckCheck,
  Eye,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  AlertOctagon,
} from "lucide-react";
import { getCampaigns, getCampaignMessages } from "../services/api";
import { useSocket } from "../context/SocketContext";

const STATUS_STYLES = {
  completed: "bg-wa-green/10 text-wa-green",
  running: "bg-yellow-400/10 text-yellow-400",
  failed: "bg-red-400/10 text-red-400",
};

export default function Campaigns() {
  const { socket } = useSocket();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedCampaignId, setExpandedCampaignId] = useState(null);
  const [campaignMessages, setCampaignMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const loadCampaigns = async () => {
    try {
      const res = await getCampaigns();
      setCampaigns(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCampaigns();
  }, []);

  // Socket.io for live status updates in the dashboard
  useEffect(() => {
    if (!socket) return;

    const handleCampaignUpdate = (data) => {
      setCampaigns((prev) =>
        prev.map((c) =>
          c._id === data.campaignId
            ? {
                ...c,
                sentCount: data.sentCount,
                deliveredCount: data.deliveredCount,
                readCount: data.readCount,
                failedCount: data.failedCount,
                status: data.status || c.status,
              }
            : c
        )
      );
    };

    const handleStatusUpdate = ({ messageId, status, errorDetails }) => {
      // If expanded campaign logs are open, update the rows dynamically
      setCampaignMessages((prev) =>
        prev.map((m) =>
          m.messageId === messageId
            ? { ...m, status, ...(errorDetails && { errorDetails }) }
            : m
        )
      );
    };

    socket.on("campaign_update", handleCampaignUpdate);
    socket.on("status_update", handleStatusUpdate);

    return () => {
      socket.off("campaign_update", handleCampaignUpdate);
      socket.off("status_update", handleStatusUpdate);
    };
  }, [socket]);

  const handleToggleExpand = async (campaignId) => {
    if (expandedCampaignId === campaignId) {
      setExpandedCampaignId(null);
      setCampaignMessages([]);
      return;
    }
    setExpandedCampaignId(campaignId);
    setLoadingMessages(true);
    try {
      const res = await getCampaignMessages(campaignId);
      setCampaignMessages(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMessages(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 bg-slate-50">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-slate-900">Campaigns</h1>
        <p className="text-slate-500 text-sm mt-1">History of all bulk campaigns sent</p>
      </div>

      {loading ? (
        <div className="grid gap-4">
          {Array(4)
            .fill(0)
            .map((_, i) => (
              <div key={i} className="card p-5 animate-pulse">
                <div className="h-4 bg-surface-hover rounded w-48 mb-3" />
                <div className="grid grid-cols-4 gap-4">
                  {Array(4)
                    .fill(0)
                    .map((_, j) => (
                      <div key={j} className="h-8 bg-surface-hover rounded" />
                    ))}
                </div>
              </div>
            ))}
        </div>
      ) : campaigns.length === 0 ? (
        <div className="card p-12 text-center bg-white shadow-sm rounded-2xl">
          <Megaphone size={32} className="text-slate-400 mx-auto mb-3" />
          <p className="text-slate-600 text-sm font-semibold">No campaigns yet.</p>
          <p className="text-slate-400 text-xs mt-1">
            Send your first bulk campaign from the Bulk Send page.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {campaigns.map((c) => {
            const isExpanded = expandedCampaignId === c._id;
            const totalSuccessful = (c.deliveredCount || 0) + (c.readCount || 0);
            const deliveryRate = c.sentCount > 0
              ? Math.round((totalSuccessful / c.sentCount) * 100)
              : 0;

            return (
              <div key={c._id} className="card p-5 bg-white shadow-sm rounded-2xl border border-slate-100 flex flex-col gap-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-slate-900 font-bold text-sm">{c.name}</h3>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className={`badge text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${STATUS_STYLES[c.status]}`}>
                        {c.status}
                      </span>
                      <span className="text-slate-400 text-xs font-semibold">
                        {c.templateName ? `Template: ${c.templateName}` : "Free Text"}
                      </span>
                      <span className="text-slate-300 text-xs">·</span>
                      <span className="text-slate-400 text-xs flex items-center gap-1 font-mono">
                        <Clock size={12} />
                        {new Date(c.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-wa-green font-extrabold text-lg">{deliveryRate}%</p>
                    <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">delivery rate</p>
                  </div>
                </div>

                {/* Stats bar */}
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                  {[
                    { icon: TrendingUp, label: "Total Recipient", value: c.totalContacts, color: "text-slate-500" },
                    { icon: TrendingUp, label: "Sent", value: c.sentCount, color: "text-blue-500" },
                    { icon: CheckCheck, label: "Delivered", value: c.deliveredCount, color: "text-wa-green" },
                    { icon: Eye, label: "Read", value: c.readCount, color: "text-cyan-500" },
                    { icon: XCircle, label: "Failed", value: c.failedCount, color: "text-red-500" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-slate-50 rounded-xl px-4 py-2.5 border border-slate-100/50">
                      <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">{label}</p>
                      <p className={`text-base font-extrabold mt-0.5 ${color}`}>{value}</p>
                    </div>
                  ))}
                </div>

                {/* Progress bar */}
                {c.totalContacts > 0 && (
                  <div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex">
                      <div
                        className="h-full bg-wa-green rounded-full transition-all duration-500"
                        style={{ width: `${(totalSuccessful / c.totalContacts) * 100}%` }}
                      />
                      <div
                        className="h-full bg-cyan-400 transition-all duration-500"
                        style={{ width: `${((c.readCount || 0) / c.totalContacts) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Expanded logs section */}
                {isExpanded && (
                  <div className="mt-2 border-t border-slate-100 pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Campaign Logs
                      </h4>
                      <button
                        onClick={() => handleToggleExpand(c._id)}
                        className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 font-semibold"
                      >
                        <ChevronUp size={14} /> Hide logs
                      </button>
                    </div>

                    {loadingMessages ? (
                      <div className="flex items-center justify-center py-6 text-xs text-slate-500 gap-2">
                        <div className="w-4.5 h-4.5 border-2 border-wa-green border-t-transparent rounded-full animate-spin" />
                        Loading log details...
                      </div>
                    ) : campaignMessages.length === 0 ? (
                      <p className="text-xs text-slate-400 py-3 text-center bg-slate-50 rounded-xl">
                        No individual logs found for this campaign.
                      </p>
                    ) : (
                      <div className="overflow-x-auto rounded-xl border border-slate-100 bg-white">
                        <table className="w-full text-left text-xs text-slate-600">
                          <thead>
                            <tr className="border-b border-slate-100 bg-slate-50 text-slate-500 font-bold">
                              <th className="p-3">Contact Name</th>
                              <th className="p-3">Phone</th>
                              <th className="p-3">Status</th>
                              <th className="p-3">Details / Error Log</th>
                            </tr>
                          </thead>
                          <tbody>
                            {campaignMessages.map((m) => (
                              <tr key={m._id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                                <td className="p-3 text-slate-800 font-semibold">{m.contactName || "—"}</td>
                                <td className="p-3 font-mono text-slate-400">{m.phone}</td>
                                <td className="p-3">
                                  <span
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                      m.status === "read"
                                        ? "bg-cyan-100 text-cyan-700"
                                        : m.status === "delivered"
                                        ? "bg-wa-green/20 text-wa-green"
                                        : m.status === "failed"
                                        ? "bg-red-100 text-red-700"
                                        : "bg-blue-100 text-blue-700"
                                    }`}
                                  >
                                    {m.status}
                                  </span>
                                </td>
                                <td className="p-3 text-slate-500 max-w-[250px] truncate" title={m.errorDetails || ""}>
                                  {m.status === "failed" && m.errorDetails ? (
                                    <span className="text-red-500 flex items-center gap-1 font-medium">
                                      <AlertOctagon size={12} className="shrink-0" />
                                      {m.errorDetails}
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* Expand toggler button */}
                {!isExpanded && (
                  <div className="flex justify-end">
                    <button
                      onClick={() => handleToggleExpand(c._id)}
                      className="text-xs text-wa-green hover:text-wa-green/80 flex items-center gap-1 font-semibold bg-[#F3FAF4] hover:bg-[#E8F5EB] px-3.5 py-2 rounded-xl transition-all border border-wa-green/10"
                    >
                      <ChevronDown size={14} /> View Message Logs
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
