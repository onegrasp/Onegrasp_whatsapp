import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Loader2, X } from "lucide-react";

export function PageHeader({ title, description, actions, children }) {
  return (
    <header className="border-b border-gray-200 bg-white px-4 py-4 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-gray-500">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

// Standard scrolling page: header plus padded content area. Scroll areas are
// `relative` so absolutely positioned content (sr-only labels) is clipped by
// the scroll area rather than extending the whole page.
export function Page({ header, children, className = "" }) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {header}
      <div className={`relative min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8 ${className}`}>{children}</div>
    </div>
  );
}

export function Spinner({ size = 16, className = "text-gray-400" }) {
  return <Loader2 size={size} className={`animate-spin ${className}`} aria-hidden="true" />;
}

export function LoadingRows({ rows = 6, cols = 5 }) {
  return Array.from({ length: rows }).map((_, i) => (
    <tr key={i}>
      {Array.from({ length: cols }).map((__, j) => (
        <td key={j}>
          <div className="h-3 w-full max-w-[160px] animate-pulse rounded-sm bg-gray-100" />
        </td>
      ))}
    </tr>
  ));
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {Icon && <Icon size={20} className="mb-3 text-gray-400" aria-hidden="true" />}
      <p className="text-sm font-medium text-gray-900">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-gray-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="flex-1">{message}</div>
      {onRetry && (
        <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

// Full class names (not built from `tone`) so Tailwind keeps them in the build.
const BADGE_TONE_CLASS = {
  neutral: "badge-neutral",
  success: "badge-success",
  warning: "badge-warning",
  danger: "badge-danger",
  info: "badge-info",
};

export function Badge({ tone = "neutral", children, className = "" }) {
  return <span className={`badge ${BADGE_TONE_CLASS[tone] || BADGE_TONE_CLASS.neutral} ${className}`}>{children}</span>;
}

const CAMPAIGN_STATUS = {
  completed: { tone: "success", label: "Completed" },
  running: { tone: "info", label: "Running" },
  scheduled: { tone: "neutral", label: "Scheduled" },
  paused: { tone: "warning", label: "Paused" },
  cancelled: { tone: "neutral", label: "Cancelled" },
  failed: { tone: "danger", label: "Failed" },
};

const MESSAGE_STATUS = {
  read: { tone: "success", label: "Read" },
  delivered: { tone: "info", label: "Delivered" },
  sent: { tone: "neutral", label: "Sent" },
  accepted: { tone: "neutral", label: "Sent" },
  queued: { tone: "neutral", label: "Queued" },
  sending: { tone: "neutral", label: "Sending" },
  pending: { tone: "neutral", label: "Pending" },
  failed: { tone: "danger", label: "Failed" },
  undelivered: { tone: "danger", label: "Undelivered" },
};

const TEMPLATE_STATUS = {
  approved: { tone: "success", label: "Approved" },
  pending: { tone: "warning", label: "Pending" },
  received: { tone: "warning", label: "Pending" },
  rejected: { tone: "danger", label: "Rejected" },
};

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

export function StatusBadge({ kind, status }) {
  const map = kind === "campaign" ? CAMPAIGN_STATUS : kind === "template" ? TEMPLATE_STATUS : MESSAGE_STATUS;
  const fallback = kind === "template" ? { tone: "neutral", label: "Draft" } : { tone: "neutral", label: capitalize(status) || "—" };
  const { tone, label } = map[status] || fallback;
  return <Badge tone={tone}>{label}</Badge>;
}

export function SegmentedControl({ value, onChange, options, label, size = "md" }) {
  const height = size === "sm" ? "h-8" : "h-9";
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex ${height} rounded-md border border-gray-300 bg-gray-50 p-0.5`}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={`flex-1 whitespace-nowrap rounded px-3 text-13 font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-600/40 ${
              active ? "bg-white text-gray-900 shadow-xs ring-1 ring-gray-200" : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {opt.label}
            {opt.count !== undefined && <span className="ml-1.5 text-gray-400 tabular-nums">{opt.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// Field wrapper that wires a visible label to its control.
export function Field({ label, hint, error, children, className = "" }) {
  const id = useId();
  const control = typeof children === "function" ? children(id) : children;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="label">
          {label}
        </label>
      )}
      {control}
      {error ? <p className="field-error">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

// Open overlays in stacking order, so Escape closes only the topmost one
// (e.g. an image viewer opened from a preview opened from an editor).
const overlayStack = [];

function useEscape(open, onClose) {
  const idRef = useRef(Symbol("overlay"));
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const id = idRef.current;
    overlayStack.push(id);
    const onKey = (e) => {
      if (e.key === "Escape" && overlayStack[overlayStack.length - 1] === id) {
        closeRef.current?.();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const index = overlayStack.lastIndexOf(id);
      if (index !== -1) overlayStack.splice(index, 1);
    };
  }, [open]);
}

function useInitialFocus(open, ref) {
  useEffect(() => {
    if (!open || !ref.current) return;
    const target = ref.current.querySelector("[data-autofocus], input:not([type=hidden]):not([disabled]), textarea, select");
    (target || ref.current).focus();
  }, [open, ref]);
}

const DIALOG_WIDTHS = { sm: "sm:max-w-sm", md: "sm:max-w-md", lg: "sm:max-w-lg", xl: "sm:max-w-2xl", "2xl": "sm:max-w-4xl" };

export function Dialog({ open, onClose, title, description, children, footer, size = "md", initialFocus = true }) {
  const ref = useRef(null);
  const titleId = useId();
  useEscape(open, onClose);
  useInitialFocus(open && initialFocus, ref);
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-gray-900/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex max-h-[92vh] w-full flex-col rounded-t-lg bg-white shadow-overlay focus:outline-hidden sm:rounded-lg ${DIALOG_WIDTHS[size]}`}
      >
        <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-gray-900">
              {title}
            </h2>
            {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm btn-icon -mr-2 -mt-1" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 rounded-b-lg border-t border-gray-200 bg-gray-50 px-5 py-3">{footer}</div>
        )}
      </div>
    </div>,
    document.body
  );
}

// Full-height panel from the right, for larger editors.
export function Sheet({ open, onClose, title, description, actions, children, footer, width = "max-w-5xl" }) {
  const ref = useRef(null);
  const titleId = useId();
  useEscape(open, onClose);
  useInitialFocus(open, ref);
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-gray-900/30" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex h-full w-full flex-col bg-white shadow-overlay focus:outline-hidden ${width}`}
      >
        <div className="flex items-center justify-between gap-4 border-b border-gray-200 px-5 py-3.5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-gray-900">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-sm text-gray-500">{description}</p>}
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm btn-icon" aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
