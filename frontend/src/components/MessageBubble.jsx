import { useState } from "react";
import { AlertCircle, Check, CheckCheck, Clock, FileText, Paperclip } from "lucide-react";
import { formatTime } from "../lib/format";

const STATUS_ICON = {
  read: { Icon: CheckCheck, className: "text-[#53bdeb]", label: "Read" },
  delivered: { Icon: CheckCheck, className: "text-gray-400", label: "Delivered" },
  sent: { Icon: Check, className: "text-gray-400", label: "Sent" },
  accepted: { Icon: Check, className: "text-gray-400", label: "Sent" },
  pending: { Icon: Clock, className: "text-gray-400", label: "Sending" },
  queued: { Icon: Clock, className: "text-gray-400", label: "Sending" },
  sending: { Icon: Clock, className: "text-gray-400", label: "Sending" },
  failed: { Icon: AlertCircle, className: "text-red-600", label: "Failed" },
  undelivered: { Icon: AlertCircle, className: "text-red-600", label: "Not delivered" },
};

function StatusIcon({ status, errorDetails }) {
  const meta = STATUS_ICON[status];
  if (!meta) return null;
  const { Icon, className, label } = meta;
  const title = errorDetails && (status === "failed" || status === "undelivered") ? `${label}: ${errorDetails}` : label;
  return (
    <span title={title} className="inline-flex">
      <Icon size={14} className={className} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function Attachment({ url }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-1.5 text-13 text-brand-700 underline">
        <Paperclip size={13} aria-hidden="true" />
        Open attachment
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="mb-1.5 block overflow-hidden rounded-md bg-black/5">
      <img src={url} alt="Attachment" loading="lazy" onError={() => setBroken(true)} className="max-h-80 w-full object-contain" />
    </a>
  );
}

export default function MessageBubble({ message }) {
  const isOutgoing = message.direction === "outgoing";
  const rawText = message.text || "";
  const mediaUrl = message.mediaUrl || message.media_url || message.media;
  const failed = message.status === "failed" || message.status === "undelivered";

  let templateId = message.templateName || "";
  let displayText = rawText;
  if (rawText.startsWith("[Template:")) {
    templateId = rawText.replace(/^\[Template:\s*/i, "").replace(/\]$/, "").trim();
    displayText = "";
  } else if (rawText.includes("[ID:")) {
    const parts = rawText.split("[ID:");
    displayText = parts[0].trim();
    templateId = parts[1].replace(/\]$/, "").trim();
  }

  return (
    <div className={`flex ${isOutgoing ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm text-gray-900 shadow-xs sm:max-w-[70%] ${
          isOutgoing ? "rounded-tr-sm bg-[#d9fdd3]" : "rounded-tl-sm bg-white ring-1 ring-gray-200"
        }`}
      >
        {mediaUrl && <Attachment url={mediaUrl} />}
        {displayText && <p className="whitespace-pre-wrap wrap-break-word leading-relaxed">{displayText}</p>}
        {templateId && (
          <p className={`flex items-center gap-1 text-xs text-gray-500 ${displayText || mediaUrl ? "mt-1" : ""}`}>
            <FileText size={12} aria-hidden="true" />
            <span className="truncate">Template {templateId}</span>
          </p>
        )}
        <div className="mt-1 flex items-center justify-end gap-1 text-2xs text-gray-500">
          <span>{formatTime(message.timestamp)}</span>
          {isOutgoing && <StatusIcon status={message.status} errorDetails={message.errorDetails} />}
        </div>
        {isOutgoing && failed && message.errorDetails && <p className="mt-1 text-xs text-red-700">{message.errorDetails}</p>}
      </div>
    </div>
  );
}
