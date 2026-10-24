import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Megaphone } from "lucide-react";
import { getStats, getCampaigns } from "../services/api";
import { EmptyState, ErrorState, LoadingRows, Page, PageHeader, StatusBadge } from "../components/ui";
import { formatDateTime, formatNumber } from "../lib/format";

function Metric({ label, value, detail, loading }) {
  return (
    <div className="bg-white px-5 py-4">
      <p className="text-sm text-gray-500">{label}</p>
      {loading ? (
        <div className="mt-2 h-7 w-20 animate-pulse rounded bg-gray-100" />
      ) : (
        <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{value}</p>
      )}
      {detail && <p className="mt-1 text-xs text-gray-500">{detail}</p>}
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [s, c] = await Promise.all([getStats(), getCampaigns()]);
      setStats(s.data);
      setCampaigns((c.data || []).slice(0, 5));
    } catch (err) {
      console.error(err);
      setError("Dashboard data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Computed on the server from outgoing messages only (replies don't count).
  const deliveryRate = stats?.deliveryRate || 0;

  return (
    <Page header={<PageHeader title="Dashboard" description="Messaging activity across all campaigns and chats." />}>
      <div className="space-y-6">
        {error && <ErrorState message={error} onRetry={load} />}

        <section aria-label="Key metrics" className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 sm:grid-cols-2 xl:grid-cols-4">
          <Metric loading={loading} label="Contacts" value={formatNumber(stats?.totalContacts)} />
          <Metric loading={loading} label="Messages" value={formatNumber(stats?.totalMessages)} detail="Sent and received" />
          <Metric loading={loading} label="Delivery rate" value={`${deliveryRate}%`} detail="Outgoing messages delivered or read" />
          <Metric loading={loading} label="Replies received" value={formatNumber(stats?.incomingMessages)} />
        </section>

        <section aria-label="Message status" className="panel">
          <h2 className="section-title border-b border-gray-200 px-5 py-3">Message status</h2>
          <dl className="grid grid-cols-3 divide-x divide-gray-200">
            {[
              { label: "Delivered", value: stats?.deliveredMessages },
              { label: "Read", value: stats?.readMessages },
              { label: "Failed", value: stats?.failedMessages, danger: true },
            ].map((item) => (
              <div key={item.label} className="px-5 py-3">
                <dt className="text-xs text-gray-500">{item.label}</dt>
                <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${item.danger && item.value > 0 ? "text-red-600" : "text-gray-900"}`}>
                  {loading ? "—" : formatNumber(item.value)}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
            <h2 className="section-title">Recent campaigns</h2>
            <Link to="/campaigns" className="text-sm font-medium text-brand-700 hover:text-brand-800">
              View all
            </Link>
          </div>
          {!loading && campaigns.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title="No campaigns yet"
              description="Campaigns you send from Bulk send appear here."
              action={<Link to="/bulk" className="btn btn-primary btn-sm">New campaign</Link>}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Status</th>
                    <th className="text-right">Recipients</th>
                    <th className="text-right">Sent</th>
                    <th className="text-right">Delivered</th>
                    <th className="text-right">Read</th>
                    <th className="text-right">Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <LoadingRows rows={3} cols={7} />
                  ) : (
                    campaigns.map((c) => (
                      <tr key={c._id}>
                        <td>
                          <p className="font-medium text-gray-900">{c.name}</p>
                          <p className="text-xs text-gray-500">{formatDateTime(c.createdAt)}</p>
                        </td>
                        <td>
                          <StatusBadge kind="campaign" status={c.status} />
                        </td>
                        <td className="num text-right">{formatNumber(c.totalContacts)}</td>
                        <td className="num text-right">{formatNumber(c.sentCount || 0)}</td>
                        <td className="num text-right">{formatNumber(c.deliveredCount || 0)}</td>
                        <td className="num text-right">{formatNumber(c.readCount || 0)}</td>
                        <td className={`num text-right ${c.failedCount > 0 ? "text-red-600" : ""}`}>{formatNumber(c.failedCount || 0)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Page>
  );
}
