import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Pause, Play, RefreshCw, ScrollText } from "lucide-react";
import { getLogs } from "../services/api";
import { Badge, EmptyState, Page, PageHeader, SegmentedControl, Spinner } from "../components/ui";

const LEVEL_TONE = { ERROR: "danger", WARN: "warning", INFO: "info", DEBUG: "neutral" };
const LEVELS = ["ALL", "ERROR", "WARN", "INFO", "DEBUG"];
const REFRESH_MS = 3000;

// Keys derived from content (not position) so an expanded row stays expanded
// when new entries arrive during live refresh.
const withStableKeys = (logs) => {
  const seen = new Map();
  return logs.map((log) => {
    const base = `${log.timestamp}|${log.level}|${log.requestId || ""}|${log.message}`;
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return { key: `${base}|${n}`, log };
  });
};

const formatLogTime = (ts) =>
  new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

function LogRow({ log }) {
  const [open, setOpen] = useState(false);
  const hasDetails = Boolean(log.requestId || log.error || log.statusCode);

  return (
    <li className="border-b border-gray-100 last:border-b-0">
      <button
        type="button"
        onClick={() => hasDetails && setOpen(!open)}
        aria-expanded={hasDetails ? open : undefined}
        className={`flex w-full items-start gap-3 px-4 py-2.5 text-left ${hasDetails ? "hover:bg-gray-50" : "cursor-default"}`}
      >
        <span className="w-4 shrink-0 pt-0.5 text-gray-400" aria-hidden="true">
          {hasDetails && <ChevronRight size={14} className={`transition-transform ${open ? "rotate-90" : ""}`} />}
        </span>
        <span className="w-16 shrink-0 pt-px font-mono text-xs text-gray-500">{formatLogTime(log.timestamp)}</span>
        <span className="w-14 shrink-0">
          <Badge tone={LEVEL_TONE[log.level] || "neutral"}>{log.level}</Badge>
        </span>
        <span className="min-w-0 flex-1 wrap-break-word text-13 text-gray-800">{log.message}</span>
      </button>

      {open && hasDetails && (
        <div className="space-y-2 pb-3 pl-31 pr-4 text-xs text-gray-600">
          {log.requestId && (
            <p>
              <span className="text-gray-500">Request ID </span>
              <code className="font-mono text-gray-800">{log.requestId}</code>
            </p>
          )}
          {log.correlationId && log.correlationId !== log.requestId && (
            <p>
              <span className="text-gray-500">Correlation ID </span>
              <code className="font-mono text-gray-800">{log.correlationId}</code>
            </p>
          )}
          {log.statusCode && (
            <p>
              <span className="text-gray-500">Status </span>
              <span className={log.statusCode >= 400 ? "font-medium text-red-600" : "font-medium text-gray-800"}>{log.statusCode}</span>
            </p>
          )}
          {log.error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-800">
              <p className="font-medium">{log.error.message}</p>
              {log.error.code && <p className="mt-0.5">Code: {log.error.code}</p>}
              {log.error.stack && <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-2xs text-red-700">{log.error.stack}</pre>}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("ALL");
  const [live, setLive] = useState(true);
  const intervalRef = useRef(null);

  const fetchLogs = useCallback(async () => {
    try {
      const params = { limit: 200 };
      if (filter !== "ALL") params.level = filter.toLowerCase();
      const res = await getLogs(params);
      setLogs(res.data.data || []);
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (live) intervalRef.current = setInterval(fetchLogs, REFRESH_MS);
    return () => intervalRef.current && clearInterval(intervalRef.current);
  }, [live, fetchLogs]);

  const errorCount = logs.filter((l) => l.level === "ERROR").length;
  const warnCount = logs.filter((l) => l.level === "WARN").length;

  return (
    <Page
      header={
        <PageHeader
          title="Logs"
          description="Recent server activity, kept in memory until the server restarts."
          actions={
            <>
              <button type="button" onClick={() => setLive(!live)} className="btn btn-secondary" aria-pressed={live}>
                {live ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                {live ? "Pause" : "Resume"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setLoading(true);
                  fetchLogs();
                }}
                className="btn btn-secondary btn-icon"
                aria-label="Refresh logs"
              >
                <RefreshCw size={14} />
              </button>
            </>
          }
        />
      }
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="Filter by level"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={LEVELS.map((l) => ({ value: l, label: l === "ALL" ? "All" : l.charAt(0) + l.slice(1).toLowerCase() }))}
        />
        <p className="flex items-center gap-3 text-xs text-gray-500">
          <span className="tabular-nums">{logs.length} entries</span>
          <span className={`tabular-nums ${errorCount ? "text-red-600" : ""}`}>{errorCount} errors</span>
          <span className={`tabular-nums ${warnCount ? "text-amber-700" : ""}`}>{warnCount} warnings</span>
          <span className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-brand-500" : "bg-gray-300"}`} aria-hidden="true" />
            {live ? "Live" : "Paused"}
          </span>
        </p>
      </div>

      <div className="panel overflow-hidden">
        {loading && logs.length === 0 ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-gray-500">
            <Spinner /> Loading logs…
          </div>
        ) : logs.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No logs"
            description={filter !== "ALL" ? `No ${filter.toLowerCase()} entries. Try another level.` : "Entries appear here as the server handles requests."}
          />
        ) : (
          <ul>
            {withStableKeys(logs).map(({ key, log }) => (
              <LogRow key={key} log={log} />
            ))}
          </ul>
        )}
      </div>
    </Page>
  );
}
