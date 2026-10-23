import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getSettings, updateSettings } from "../services/api";
import { Dialog, Field, SegmentedControl } from "./ui";
import { useToast } from "./feedback";
import { errorMessage } from "../lib/format";

const SettingsContext = createContext(null);

const DEFAULTS = {
  autoReplyEnabled: false,
  autoReplyMessage: "",
  twilioMode: "sandbox",
  twilioAccountSid: "",
  twilioAuthToken: "",
  twilioWhatsappNumber: "",
  twilioMessagingServiceSid: "",
  validateWebhookSignature: false,
  sendingRate: 2,
};

const fromResponse = (data = {}) => ({
  autoReplyEnabled: Boolean(data.autoReplyEnabled),
  autoReplyMessage: data.autoReplyMessage || "",
  twilioMode: data.twilioMode || "sandbox",
  twilioAccountSid: data.twilioAccountSid || "",
  twilioAuthToken: data.twilioAuthToken || "",
  twilioWhatsappNumber: data.twilioWhatsappNumber || "",
  twilioMessagingServiceSid: data.twilioMessagingServiceSid || "",
  validateWebhookSignature: Boolean(data.validateWebhookSignature),
  sendingRate: data.sendingRate || 2,
});

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULTS);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await getSettings();
      setSettings(fromResponse(res.data));
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <SettingsContext.Provider value={{ settings, openSettings: () => setOpen(true) }}>
      {children}
      <SettingsDialog
        open={open}
        initial={settings}
        onClose={() => setOpen(false)}
        onSaved={(next) => {
          setSettings(next);
          setOpen(false);
        }}
      />
    </SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);

function Toggle({ checked, onChange, label, description }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-gray-500">{description}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-5 w-9 rounded-full bg-gray-300 transition-colors peer-checked:bg-brand-600 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-600/40 peer-focus-visible:ring-offset-1" />
        <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

function SettingsDialog({ open, initial, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);

  // Start from the latest saved values every time the dialog opens, so
  // cancelling discards edits.
  useEffect(() => {
    if (open) setForm(initial);
  }, [open, initial]);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateSettings(form);
      toast.success("Settings saved");
      onSaved(form);
    } catch (err) {
      toast.error(`Could not save settings: ${errorMessage(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Settings"
      description="Auto-reply and WhatsApp provider configuration."
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="settings-form" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
        </>
      }
    >
      <form id="settings-form" onSubmit={handleSave} className="space-y-6">
        <section className="space-y-4">
          <h3 className="section-title">Auto-reply</h3>
          <Toggle
            checked={form.autoReplyEnabled}
            onChange={set("autoReplyEnabled")}
            label="Reply automatically to incoming messages"
            description="Sends the message below whenever a customer writes to you."
          />
          <Field label="Reply message">
            {(id) => (
              <textarea
                id={id}
                rows={3}
                className="input resize-none"
                value={form.autoReplyMessage}
                onChange={(e) => set("autoReplyMessage")(e.target.value)}
                disabled={!form.autoReplyEnabled}
                placeholder="Thanks for your message — we'll get back to you shortly."
              />
            )}
          </Field>
        </section>

        <section className="space-y-4 border-t border-gray-200 pt-5">
          <div>
            <h3 className="section-title">Twilio</h3>
            <p className="mt-0.5 text-xs text-gray-500">Changes here affect all sending. Values left empty fall back to the server environment.</p>
          </div>

          <div>
            <span className="label">Mode</span>
            <SegmentedControl
              label="Twilio mode"
              value={form.twilioMode}
              onChange={set("twilioMode")}
              options={[
                { value: "sandbox", label: "Sandbox" },
                { value: "production", label: "Production" },
              ]}
            />
            {form.twilioMode === "sandbox" && (
              <p className="hint">Sandbox sends from Twilio's shared number (+1 415 523 8886) to numbers that joined the sandbox.</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Account SID">
              {(id) => (
                <input id={id} className="input font-mono text-13" placeholder="AC…" value={form.twilioAccountSid} onChange={(e) => set("twilioAccountSid")(e.target.value)} />
              )}
            </Field>
            <Field label="Auth token" hint="Primary Auth Token of the sending account. Used to verify webhooks.">
              {(id) => (
                <input id={id} type="password" className="input font-mono text-13" placeholder="Auth token" value={form.twilioAuthToken} onChange={(e) => set("twilioAuthToken")(e.target.value)} autoComplete="off" />
              )}
            </Field>
            {form.twilioMode === "production" && (
              <>
                <Field label="WhatsApp number">
                  {(id) => (
                    <input id={id} className="input font-mono text-13" placeholder="+14155238886" value={form.twilioWhatsappNumber} onChange={(e) => set("twilioWhatsappNumber")(e.target.value)} />
                  )}
                </Field>
                <Field label="Messaging service SID" hint="Optional">
                  {(id) => (
                    <input id={id} className="input font-mono text-13" placeholder="MG…" value={form.twilioMessagingServiceSid} onChange={(e) => set("twilioMessagingServiceSid")(e.target.value)} />
                  )}
                </Field>
              </>
            )}
          </div>

          <Toggle
            checked={form.validateWebhookSignature}
            onChange={set("validateWebhookSignature")}
            label="Verify webhook signatures"
            description="Rejects delivery updates and replies that aren't signed by Twilio."
          />

          <Field label="Sending rate" hint="Messages per second for bulk campaigns.">
            {(id) => (
              <input
                id={id}
                type="number"
                min="0.1"
                max="100"
                step="0.1"
                className="input w-32 tabular-nums"
                value={form.sendingRate}
                onChange={(e) => set("sendingRate")(e.target.value)}
              />
            )}
          </Field>
        </section>
      </form>
    </Dialog>
  );
}
