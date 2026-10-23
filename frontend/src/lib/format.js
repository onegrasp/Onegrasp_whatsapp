const numberFormat = new Intl.NumberFormat();

export const formatNumber = (value) =>
  value === null || value === undefined || Number.isNaN(Number(value)) ? "—" : numberFormat.format(Number(value));

export const formatPercent = (value) => `${Math.round(value)}%`;

export const formatDate = (ts) =>
  ts ? new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

export const formatDateTime = (ts) =>
  ts
    ? new Date(ts).toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export const formatTime = (ts) =>
  ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

// Compact relative time for lists: "now", "5m", "3h", or a short date.
export const formatRelative = (ts) => {
  if (!ts) return "";
  const diffMinutes = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (diffMinutes < 1) return "now";
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `${hours}h`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
};

// "Today", "Yesterday" or a full date — used as day separators in chat.
export const formatDayLabel = (ts) => {
  const date = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
};

// Extracts a readable message from an axios error. The API client already
// flattens server errors into `response.data.error`.
export const errorMessage = (err, fallback = "Something went wrong. Please try again.") => {
  const data = err?.response?.data?.error;
  if (typeof data === "string" && data) return data;
  if (data && typeof data === "object" && data.message) return data.message;
  return err?.message || fallback;
};
