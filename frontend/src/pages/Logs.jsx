import { useEffect, useState, useRef } from "react";
import {
  ScrollText,
  RefreshCw,
  AlertTriangle,
  Info,
  AlertCircle,
  Bug,
  Filter,
  Trash2,
  ChevronDown,
  ChevronRight,
  Clock,
  Hash,
} from "lucide-react";
import { getLogs } from "../services/api";

const LEVEL_CONFIG = {
  ERROR: {
    icon: AlertCircle,
    bg: "bg-red-50",
    border: "border-red-200",
    text: "text-red-700",
    badge: "bg-red-100 text-red-700",
    dot: "bg-red-500",
  },
  WARN: {
    icon: AlertTriangle,
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
    badge: "bg-amber-100 text-amber-700",
    dot: "bg-amber-500",
  },
  INFO: {
    icon: Info,
    bg: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-700",
    badge: "bg-blue-100 text-blue-700",
    dot: "bg-blue-500",
  },
  DEBUG: {
    icon: Bug,
    bg: "bg-slate-50",
    border: "border-slate-200",
    text: "text-slate-600",
    badge: "bg-slate-100 text-slate-600",
    dot: "bg-slate-400",
  },
};

const LogEntry = ({ log }) => {
  const [expanded, setExpanded] = useState(false);
  const config = LEVEL_CONFIG[log.level] || LEVEL_CONFIG.DEBUG;
  const Icon = config.icon;
  const time = new Date(log.timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const hasDetails =
    log.requestId || log.error || log.headers || log.body || log.statusCode;

  return (
    <div
      className={`border ${config.border} ${config.bg} rounded-xl transition-all duration-200 hover:shadow-sm`}
    >
      <div
        className="flex items-start gap-3 px-4 py-3 cursor-pointer"
        onClick={() => hasDetails && setExpanded(!expanded)}
      >
        {/* Expand icon */}
        <div className="mt-0.5 shrink-0">
          {hasDetails ? (
            expanded ? (
              <ChevronDown size={14} className="text-slate-400" />
            ) : (
              <ChevronRight size={14} className="text-slate-400" />
            )
          ) : (
            <div className={`w-2 h-2 rounded-full mt-1.5 ${config.dot}`} />
          )}
        </div>

        {/* Level icon */}
        <Icon size={16} className={`shrink-0 mt-0.5 ${config.text}`} />

        {/* Message */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-800 font-medium break-all leading-relaxed">
            {log.message}
          </p>
        </div>

        {/* Meta */}
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-md ${config.badge}`}
          >
            {log.level}
          </span>
          <span className="text-[11px] text-slate-400 font-mono tabular-nums flex items-center gap-1">
            <Clock size={10} />
            {time}
          </span>
        </div>
      </div>

      {/* Expandable details */}
      {expanded && hasDetails && (
        <div className="px-4 pb-3 pt-0 ml-9 space-y-2 animate-fade-in">
          <div className="border-t border-dashed border-slate-200 pt-2" />

          {log.requestId && (
            <div className="flex items-center gap-2">
              <Hash size={12} className="text-slate-400 shrink-0" />
              <span className="text-[11px] text-slate-500 font-medium">
                Request:
              </span>
              <code className="text-[11px] bg-white px-1.5 py-0.5 rounded text-slate-600 font-mono border border-slate-200">
                {log.requestId}
              </code>
            </div>
          )}

          {log.correlationId && log.correlationId !== log.requestId && (
            <div className="flex items-center gap-2">
              <Hash size={12} className="text-slate-400 shrink-0" />
              <span className="text-[11px] text-slate-500 font-medium">
                Correlation:
              </span>
              <code className="text-[11px] bg-white px-1.5 py-0.5 rounded text-slate-600 font-mono border border-slate-200">
                {log.correlationId}
              </code>
            </div>
          )}

          {log.statusCode && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-500 font-medium ml-5">
                Status:
              </span>
              <span
                className={`text-[11px] font-bold ${
                  log.statusCode >= 400 ? "text-red-600" : "text-wa-green"
                }`}
              >
                {log.statusCode}
              </span>
            </div>
          )}

          {log.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mt-1">
              <p className="text-[11px] text-red-700 font-semibold">
                {log.error.message}
              </p>
              {log.error.code && (
                <p className="text-[11px] text-red-500 mt-0.5">
                  Code: {log.error.code}
                </p>
              )}
              {log.error.stack && (
                <pre className="text-[10px] text-red-500/80 mt-1.5 overflow-x-auto whitespace-pre-wrap max-h-24 font-mono">
                  {log.error.stack}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("ALL");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef(null);

  const fetchLogs = async () => {
    try {
      const params = {};
      if (filter !== "ALL") params.level = filter.toLowerCase();
      params.limit = 200;
      const res = await getLogs(params);
      setLogs(res.data.data || []);
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [filter]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchLogs, 3000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, filter]);

  const levels = ["ALL", "ERROR", "WARN", "INFO", "DEBUG"];

  const errorCount = logs.filter((l) => l.level === "ERROR").length;
  const warnCount = logs.filter((l) => l.level === "WARN").length;

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <ScrollText size={22} className="text-wa-green" />
            System Logs
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Real-time server activity and diagnostics
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
              autoRefresh
                ? "bg-wa-green/10 text-wa-green border border-wa-green/20"
                : "bg-slate-100 text-slate-500 border border-slate-200"
            }`}
          >
            <RefreshCw
              size={13}
              className={autoRefresh ? "animate-spin" : ""}
              style={{ animationDuration: "3s" }}
            />
            {autoRefresh ? "Live" : "Paused"}
          </button>

          {/* Manual refresh */}
          <button
            onClick={() => {
              setLoading(true);
              fetchLogs();
            }}
            className="btn-ghost border border-surface-border rounded-xl"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <div className="card px-4 py-3">
          <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
            Total
          </p>
          <p className="text-lg font-bold text-slate-800 mt-0.5">
            {logs.length}
          </p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-[10px] text-red-400 font-semibold uppercase tracking-wider">
            Errors
          </p>
          <p className="text-lg font-bold text-red-600 mt-0.5">{errorCount}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider">
            Warnings
          </p>
          <p className="text-lg font-bold text-amber-600 mt-0.5">
            {warnCount}
          </p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
            Auto Refresh
          </p>
          <p className="text-lg font-bold text-slate-800 mt-0.5">
            {autoRefresh ? "3s" : "Off"}
          </p>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex items-center gap-2 mb-4">
        <Filter size={14} className="text-slate-400" />
        {levels.map((lvl) => {
          const active = filter === lvl;
          const cfg = LEVEL_CONFIG[lvl];
          return (
            <button
              key={lvl}
              onClick={() => setFilter(lvl)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                active
                  ? lvl === "ALL"
                    ? "bg-wa-green/10 text-wa-green border border-wa-green/20"
                    : `${cfg.badge} border ${cfg.border}`
                  : "bg-white text-slate-500 border border-slate-200 hover:border-slate-300"
              }`}
            >
              {lvl}
            </button>
          );
        })}
      </div>

      {/* Log entries */}
      <div className="space-y-2">
        {loading ? (
          Array(6)
            .fill(0)
            .map((_, i) => (
              <div key={i} className="card p-4 animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 bg-slate-200 rounded" />
                  <div className="h-4 bg-slate-200 rounded flex-1" />
                  <div className="w-12 h-4 bg-slate-200 rounded" />
                </div>
              </div>
            ))
        ) : logs.length === 0 ? (
          <div className="card p-12 text-center">
            <ScrollText size={40} className="text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-sm font-medium">
              No logs found
            </p>
            <p className="text-slate-400 text-xs mt-1">
              {filter !== "ALL"
                ? `No ${filter} level logs. Try changing the filter.`
                : "Logs will appear here as the server processes requests."}
            </p>
          </div>
        ) : (
          logs.map((log, i) => <LogEntry key={`${log.timestamp}-${i}`} log={log} />)
        )}
      </div>
    </div>
  );
}
