import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { Dialog } from "./ui";

const FeedbackContext = createContext(null);

const TOAST_ICON = {
  success: <CheckCircle2 size={16} className="text-brand-600" aria-hidden="true" />,
  error: <AlertCircle size={16} className="text-red-600" aria-hidden="true" />,
  info: <Info size={16} className="text-gray-500" aria-hidden="true" />,
};

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (tone, message, { duration = tone === "error" ? 7000 : 4000 } = {}) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-3), { id, tone, message }]);
      if (duration) setTimeout(() => dismiss(id), duration);
    },
    [dismiss]
  );

  const toast = useMemo(
    () => ({
      success: (message, opts) => push("success", message, opts),
      error: (message, opts) => push("error", message, opts),
      info: (message, opts) => push("info", message, opts),
    }),
    [push]
  );

  // confirm({ title, message, confirmLabel, tone, secondaryLabel }) ->
  // Promise<true | false | "secondary">. secondaryLabel adds a second,
  // less prominent action (e.g. "Send now anyway").
  const confirm = useCallback(
    (options) => new Promise((resolve) => setConfirmState({ ...options, resolve })),
    []
  );

  const closeConfirm = (result) => {
    confirmState?.resolve(result);
    setConfirmState(null);
  };

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}

      {createPortal(
        <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-0 z-60 flex flex-col items-center gap-2 p-4 sm:items-end">
          {toasts.map((t) => (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 shadow-overlay"
            >
              <span className="mt-0.5">{TOAST_ICON[t.tone]}</span>
              <p className="flex-1 wrap-break-word">{t.message}</p>
              <button type="button" onClick={() => dismiss(t.id)} className="-mr-1 text-gray-400 hover:text-gray-600" aria-label="Dismiss">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>,
        document.body
      )}

      <Dialog
        open={Boolean(confirmState)}
        onClose={() => closeConfirm(false)}
        title={confirmState?.title || "Are you sure?"}
        size={confirmState?.secondaryLabel ? "md" : "sm"}
        initialFocus={false}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => closeConfirm(false)}>
              Cancel
            </button>
            {confirmState?.secondaryLabel && (
              <button type="button" className="btn btn-secondary" onClick={() => closeConfirm("secondary")}>
                {confirmState.secondaryLabel}
              </button>
            )}
            <button
              type="button"
              autoFocus
              className={`btn ${confirmState?.tone === "danger" ? "btn-danger" : "btn-primary"}`}
              onClick={() => closeConfirm(true)}
            >
              {confirmState?.confirmLabel || "Confirm"}
            </button>
          </>
        }
      >
        {confirmState?.message && <div className="text-sm text-gray-600">{confirmState.message}</div>}
      </Dialog>
    </FeedbackContext.Provider>
  );
}

export const useToast = () => useContext(FeedbackContext).toast;
export const useConfirm = () => useContext(FeedbackContext).confirm;
