import { useEffect, useState } from "react";
import {
  Users,
  MessageSquare,
  CheckCheck,
  Eye,
  XCircle,
  TrendingUp,
  ArrowDownLeft,
} from "lucide-react";
import { getStats, getCampaigns } from "../services/api";

const StatCard = ({ icon: Icon, label, value, color, sub }) => (
  <div className="card p-5">
    <div className="flex items-start justify-between">
      <div>
        <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">{label}</p>
        <p className={`text-3xl font-bold mt-1 ${color}`}>{value ?? "—"}</p>
        {sub && <p className="text-slate-500 text-xs mt-1">{sub}</p>}
      </div>
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color} bg-current/10`}
        style={{ backgroundColor: "rgba(255,255,255,0.05)" }}>
        <Icon size={18} className={color} />
      </div>
    </div>
  </div>
);

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [s, c] = await Promise.all([getStats(), getCampaigns()]);
        setStats(s.data);
        setCampaigns(c.data.slice(0, 5));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const deliveryRate =
    stats?.totalMessages > 0
      ? Math.round(((stats.deliveredMessages + stats.readMessages) / Math.max(stats.totalMessages, 1)) * 100)
      : 0;

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">Overview of your WhatsApp campaigns</p>
      </div>

      {/* Stats Grid */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {Array(7).fill(0).map((_, i) => (
            <div key={i} className="card p-5 animate-pulse">
              <div className="h-4 bg-surface-hover rounded w-20 mb-2" />
              <div className="h-8 bg-surface-hover rounded w-16" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard icon={Users} label="Total Contacts" value={stats?.totalContacts} color="text-blue-400" />
          <StatCard icon={MessageSquare} label="Total Messages" value={stats?.totalMessages} color="text-purple-400" />
          <StatCard icon={TrendingUp} label="Delivered" value={stats?.deliveredMessages} color="text-wa-green" />
          <StatCard icon={Eye} label="Read" value={stats?.readMessages} color="text-cyan-400" />
          <StatCard icon={XCircle} label="Failed" value={stats?.failedMessages} color="text-red-400" />
          <StatCard icon={ArrowDownLeft} label="Replies Received" value={stats?.incomingMessages} color="text-yellow-400" />
          <StatCard
            icon={CheckCheck}
            label="Delivery Rate"
            value={`${deliveryRate}%`}
            color="text-wa-green"
            sub="delivered + read"
          />
        </div>
      )}

      {/* Recent Campaigns */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-border">
          <h2 className="text-sm font-semibold text-slate-900">Recent Campaigns</h2>
        </div>
        {campaigns.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            No campaigns yet. Start by sending a bulk campaign.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border">
                  <th className="text-left px-5 py-3 text-slate-400 font-medium">Campaign</th>
                  <th className="text-left px-5 py-3 text-slate-400 font-medium">Total</th>
                  <th className="text-left px-5 py-3 text-slate-400 font-medium">Sent</th>
                  <th className="text-left px-5 py-3 text-slate-400 font-medium">Delivered</th>
                  <th className="text-left px-5 py-3 text-slate-400 font-medium">Read</th>
                  <th className="text-left px-5 py-3 text-slate-400 font-medium">Failed</th>
                  <th className="text-left px-5 py-3 text-slate-400 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c._id} className="border-b border-surface-border/50 hover:bg-surface-hover/50">
                    <td className="px-5 py-3 text-slate-900 font-medium">{c.name}</td>
                    <td className="px-5 py-3 text-slate-300">{c.totalContacts}</td>
                    <td className="px-5 py-3 text-slate-300">{c.sentCount}</td>
                    <td className="px-5 py-3 text-wa-green">{c.deliveredCount}</td>
                    <td className="px-5 py-3 text-cyan-400">{c.readCount}</td>
                    <td className="px-5 py-3 text-red-400">{c.failedCount}</td>
                    <td className="px-5 py-3">
                      <span className={`badge ${
                        c.status === "completed"
                          ? "bg-wa-green/10 text-wa-green"
                          : c.status === "running"
                          ? "bg-yellow-400/10 text-yellow-400"
                          : "bg-red-400/10 text-red-400"
                      }`}>
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
