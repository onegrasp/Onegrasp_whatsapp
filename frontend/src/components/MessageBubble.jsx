import { Check, CheckCheck, AlertCircle, Clock } from "lucide-react";

const StatusIcon = ({ status, errorDetails }) => {
  if (status === "read") return <CheckCheck size={13} className="text-[#53bdeb] shrink-0" title="Read" />;
  if (status === "delivered") return <CheckCheck size={13} className="text-slate-400/80 shrink-0" title="Delivered" />;
  if (["sent", "accepted"].includes(status)) return <Check size={13} className="text-slate-400/80 shrink-0" title="Sent" />;
  if (["pending", "queued", "sending"].includes(status)) return <Clock size={11} className="text-slate-400/60 shrink-0 animate-pulse" title="Sending..." />;
  if (["failed", "undelivered"].includes(status)) {
    return (
      <AlertCircle
        size={13}
        className="text-red-500 shrink-0 cursor-help animate-pulse"
        title={errorDetails || `Message failed: ${status}`}
      />
    );
  }
  return null;
};

const formatTime = (ts) => {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export default function MessageBubble({ message }) {
  const isOutgoing = message.direction === "outgoing";

  return (
    <div className={`flex ${isOutgoing ? "justify-end" : "justify-start"} mb-1.5`}>
      <div
        className={`max-w-[70%] px-3 py-1.5 rounded-2xl text-slate-800 text-[13px] leading-relaxed shadow-sm transition-all relative ${
          isOutgoing
            ? "bg-[#d9fdd3] border border-[#c3f0bb] text-slate-900 rounded-tr-none"
            : "bg-white border border-slate-100 text-slate-900 rounded-tl-none"
        }`}
      >
        <p className="break-words font-medium whitespace-pre-wrap">{message.text}</p>
        <div className={`flex items-center gap-1.5 mt-1 justify-end select-none`}>
          <span className="text-[10px] text-slate-400 font-semibold">
            {formatTime(message.timestamp)}
          </span>
          {isOutgoing && <StatusIcon status={message.status} errorDetails={message.errorDetails} />}
        </div>
      </div>
    </div>
  );
}
