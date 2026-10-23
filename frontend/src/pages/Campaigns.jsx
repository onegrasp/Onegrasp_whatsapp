import { Fragment, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Megaphone } from "lucide-react";
import { getCampaigns, getCampaignMessages, pauseCampaign, resumeCampaign, cancelCampaign } from "../services/api";
import { useSocket } from "../context/SocketContext";
import { EmptyState, ErrorState, LoadingRows, Page, PageHeader, Spinner, StatusBadge } from "../components/ui";
import { useConfirm, useToast } from "../components/feedback";
import { errorMessage, formatDateTime, formatNumber } from "../lib/format";

const CAMPAIGN_LIMIT = 50; // the API returns the most recent 50

const deliveryRateOf = (c) => {
  const sent = c.sentCount || 0;
  const failed = c.failedCount || 0;
  const delivered = c.deliveredCount || 0;
  const total = c.totalContacts || sent + failed || 1;
  const effectiveDelivered = delivered > 0 ? delivered : Math.max(0, sent - failed);
  return Math.min(100, Math.max(0, Math.round((effectiveDelivered / total) * 100)));
};

function CampaignLog({ loading, messages }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-6 text-sm text-gray-500">
        <Spinner /> Loading message log…
      </div>
    );
  }
  if (messages.length === 0) {
    return <p className="px-4 py-6 text-sm text-gray-500">No messages recorded for this campaign yet.</p>;
  }
  return (
    <div className="max-h-96 overflow-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Contact</th>
            <th>Phone</th>
            <th>Status</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {messages.map((m) => (
            <tr key={m._id}>
              <td className="text-gray-900">{m.contactName || "—"}</td>
              <td className="num whitespace-nowrap">{m.phone}</td>
              <td>
                <StatusBadge kind="message" status={m.status} />
              </td>
              <td className="max-w-md">
                {m.status === "failed" || m.status === "undelivered" ? (
                  <span className="text-red-700">{m.errorDetails || "Failed"}</span>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CampaignActions({ campaign, busy, onAction }) {
  const { status } = campaign;
  const stop = (fn) => (e) => {
    e.stopPropagation();
    fn();
  };
  return (
    <div className="flex justify-end gap-1">
      {(status === "running" || status === "scheduled") && (
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={stop(() => onAction("pause", campaign))}>
          Pause
        </button>
      )}
      {status === "paused" && (
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={stop(() => onAction("resume", campaign))}>
          Resume
        </button>
      )}
      {(status === "running" || status === "scheduled" || status === "paused") && (
        <button type="button" className="btn btn-danger-ghost btn-sm" disabled={busy} onClick={stop(() => onAction("cancel", campaign))}>
          Cancel
        </button>
      )}
    </div>
  );
}

export default function Campaigns() {
  const { socket } = useSocket();
  const toast = useToast();
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [campaignMessages, setCampaignMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const loadCampaigns = useCallback(async () => {
    setError("");
    try {
      const res = await getCampaigns();
      setCampaigns(res.data || []);
    } catch (err) {
      console.error(err);
      setError("Campaigns could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

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
                statusReason: data.statusReason ?? c.statusReason,
              }
            : c
        )
      );
    };

    const handleStatusUpdate = ({ messageId, status, errorDetails }) => {
      setCampaignMessages((prev) =>
        prev.map((m) => (m.messageId === messageId ? { ...m, status, ...(errorDetails && { errorDetails }) } : m))
      );
    };

    socket.on("campaign_update", handleCampaignUpdate);
    socket.on("status_update", handleStatusUpdate);
    return () => {
      socket.off("campaign_update", handleCampaignUpdate);
      socket.off("status_update", handleStatusUpdate);
    };
  }, [socket]);

  const runAction = async (action, campaign) => {
    if (action === "cancel") {
      const ok = await confirm({
        title: "Cancel this campaign?",
        message: `Messages already sent stay sent. The remaining unsent messages for "${campaign.name}" will be dropped and can't be resumed.`,
        confirmLabel: "Cancel campaign",
        tone: "danger",
      });
      if (!ok) return;
    }
    setBusyId(campaign._id);
    try {
      if (action === "pause") await pauseCampaign(campaign._id);
      if (action === "resume") await resumeCampaign(campaign._id);
      if (action === "cancel") await cancelCampaign(campaign._id);
      toast.success(
        action === "pause" ? "Campaign paused. Messages already being sent will finish." : action === "resume" ? "Campaign resumed" : "Campaign cancelled"
      );
      loadCampaigns();
    } catch (err) {
      toast.error(errorMessage(err, `Could not ${action} the campaign.`));
    } finally {
      setBusyId(null);
    }
  };

  const toggleExpand = async (campaignId) => {
    if (expandedId === campaignId) {
      setExpandedId(null);
      setCampaignMessages([]);
      return;
    }
    setExpandedId(campaignId);
    setLoadingMessages(true);
    try {
      const res = await getCampaignMessages(campaignId);
      setCampaignMessages(res.data || []);
    } catch (err) {
      console.error(err);
      setCampaignMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  };

  return (
    <Page
      header={
        <PageHeader
          title="Campaigns"
          description="Delivery results for every bulk send."
          actions={
            <Link to="/bulk" className="btn btn-primary">
              New campaign
            </Link>
          }
        />
      }
    >
      {error && (
        <div className="mb-4">
          <ErrorState message={error} onRetry={loadCampaigns} />
        </div>
      )}

      <div className="panel overflow-hidden">
        {!loading && campaigns.length === 0 && !error ? (
          <EmptyState
            icon={Megaphone}
            title="No campaigns yet"
            description="Send your first campaign from Bulk send."
            action={<Link to="/bulk" className="btn btn-primary btn-sm">New campaign</Link>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-10" aria-label="Expand" />
                  <th>Campaign</th>
                  <th>Status</th>
                  <th className="text-right">Recipients</th>
                  <th className="text-right">Sent</th>
                  <th className="text-right">Delivered</th>
                  <th className="text-right">Read</th>
                  <th className="text-right">Failed</th>
                  <th className="w-40">Delivery rate</th>
                  <th className="text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <LoadingRows rows={5} cols={10} />
                ) : (
                  campaigns.map((c) => {
                    const expanded = expandedId === c._id;
                    const rate = deliveryRateOf(c);
                    return (
                      <Fragment key={c._id}>
                        <tr className={`cursor-pointer ${expanded ? "bg-gray-50" : "hover:bg-gray-50"}`} onClick={() => toggleExpand(c._id)}>
                          <td className="pr-0">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm btn-icon"
                              aria-expanded={expanded}
                              aria-label={expanded ? `Hide message log for ${c.name}` : `Show message log for ${c.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpand(c._id);
                              }}
                            >
                              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                          </td>
                          <td className="min-w-[220px]">
                            <p className="font-medium text-gray-900">{c.name}</p>
                            <p className="text-xs text-gray-500">
                              {c.templateName ? `Template · ${c.templateName}` : "Free text"} · {formatDateTime(c.createdAt)}
                            </p>
                            {c.statusReason && (c.status === "paused" || c.status === "cancelled") && (
                              <p className={`mt-1 max-w-md text-xs ${c.status === "paused" ? "text-amber-800" : "text-gray-500"}`}>{c.statusReason}</p>
                            )}
                          </td>
                          <td>
                            <StatusBadge kind="campaign" status={c.status} />
                          </td>
                          <td className="num text-right">{formatNumber(c.totalContacts)}</td>
                          <td className="num text-right">{formatNumber(c.sentCount || 0)}</td>
                          <td className="num text-right">{formatNumber(c.deliveredCount || 0)}</td>
                          <td className="num text-right">{formatNumber(c.readCount || 0)}</td>
                          <td className={`num text-right ${c.failedCount > 0 ? "text-red-600" : ""}`}>{formatNumber(c.failedCount || 0)}</td>
                          <td>
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                                <div className="h-full rounded-full bg-brand-500" style={{ width: `${rate}%` }} />
                              </div>
                              <span className="w-9 text-right tabular-nums text-gray-900">{rate}%</span>
                            </div>
                          </td>
                          <td>
                            <CampaignActions campaign={c} busy={busyId === c._id} onAction={runAction} />
                          </td>
                        </tr>
                        {expanded && (
                          <tr>
                            <td colSpan={10} className="h-auto border-b border-gray-200 bg-gray-50 p-0">
                              <div className="m-3 rounded-md border border-gray-200 bg-white">
                                <CampaignLog loading={loadingMessages} messages={campaignMessages} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {campaigns.length >= CAMPAIGN_LIMIT && (
        <p className="mt-3 text-xs text-gray-500">Showing the {CAMPAIGN_LIMIT} most recent campaigns.</p>
      )}
    </Page>
  );
}
