import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getSettings, updateSettings } from "../services/api";
import { Dialog, ErrorState, Field, SegmentedControl } from "./ui";
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
  validateWebhookSignature: true,
  webhookSignatureLocked: false,
  sendingRate: 2,
  autoReplyCooldownHours: 12,
  dailyConversationLimit: 0,
  campaignCooldownDays: 3,
  quietHoursEnabled: true,
  quietHoursStart: "21:00",
  quietHoursEnd: "09:00",
  quietHoursTimezone: "Asia/Kolkata",
};

const valueOr = (value, fallback) => (value === undefined || value === null || value === "" ? fallback : value);

const fromResponse = (data = {}) => ({
  autoReplyCooldownHours: valueOr(data.autoReplyCooldownHours, DEFAULTS.autoReplyCooldownHours),
  dailyConversationLimit: valueOr(data.dailyConversationLimit, DEFAULTS.dailyConversationLimit),
  campaignCooldownDays: valueOr(data.campaignCooldownDays, DEFAULTS.campaignCooldownDays),
  quietHoursEnabled: data.quietHoursEnabled === undefined ? DEFAULTS.quietHoursEnabled : data.quietHoursEnabled === true || data.quietHoursEnabled === "true",
  quietHoursStart: valueOr(data.quietHoursStart, DEFAULTS.quietHoursStart),
  quietHoursEnd: valueOr(data.quietHoursEnd, DEFAULTS.quietHoursEnd),
  quietHoursTimezone: valueOr(data.quietHoursTimezone, DEFAULTS.quietHoursTimezone),
  autoReplyEnabled: Boolean(data.autoReplyEnabled),
  autoReplyMessage: data.autoReplyMessage || "",
  twilioMode: data.twilioMode || "sandbox",
  twilioAccountSid: data.twilioAccountSid || "",
  twilioAuthToken: data.twilioAuthToken || "",
  twilioWhatsappNumber: data.twilioWhatsappNumber || "",
  twilioMessagingServiceSid: data.twilioMessagingServiceSid || "",
  // Off only if the server explicitly says so.
  validateWebhookSignature: data.validateWebhookSignature !== false && data.validateWebhookSignature !== "false",
  webhookSignatureLocked: Boolean(data.webhookSignatureLocked),
  sendingRate: data.sendingRate || 2,
});

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  // True when the last load failed. The dialog then can't save: saving the
  // placeholder defaults would overwrite the real settings.
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await getSettings();
      setSettings(fromResponse(res.data));
      setLoadFailed(false);
    } catch (err) {
      console.error("Failed to load settings:", err);
      setLoadFailed(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openSettings = () => {
    if (loadFailed) refresh();
    setOpen(true);
  };

  return (
    <SettingsContext.Provider value={{ settings, loaded, openSettings }}>
      {children}
      <SettingsDialog
        open={open}
        initial={settings}
        loadFailed={loadFailed}
        onRetry={refresh}
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

function Toggle({ checked, onChange, label, description, disabled = false }) {
  return (
    <label className={`flex items-start justify-between gap-4 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
      <span>
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-gray-500">{description}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-5 w-9 rounded-full bg-gray-300 transition-colors peer-checked:bg-brand-600 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-600/40 peer-focus-visible:ring-offset-1" />
        <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

function SettingsDialog({ open, initial, loadFailed, onRetry, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    setRetrying(true);
    await onRetry();
    setRetrying(false);
  };

  // Start from the latest saved values every time the dialog opens, so
  // cancelling discards edits.
  useEffect(() => {
    if (open) setForm(initial);
  }, [open, initial]);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async (e) => {
    e.preventDefault();
    if (loadFailed) return;
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
          <button type="submit" form="settings-form" className="btn btn-primary" disabled={saving || loadFailed}>
            {saving ? "Saving…" : "Save settings"}
          </button>
        </>
      }
    >
      {loadFailed ? (
        <ErrorState
          message={retrying ? "Loading settings…" : "Settings couldn't be loaded, so they can't be edited right now. This keeps your saved settings from being overwritten."}
          onRetry={retrying ? undefined : retry}
        />
      ) : (
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
          <Field
            label="Don't repeat the auto-reply within"
            hint="Hours. Also skipped while an agent has replied to that person in this time. 0 sends it every time."
          >
            {(id) => (
              <div className="flex items-center gap-2">
                <input id={id} type="number" min="0" max="168" step="1" className="input w-24 tabular-nums" value={form.autoReplyCooldownHours} onChange={(e) => set("autoReplyCooldownHours")(e.target.value)} disabled={!form.autoReplyEnabled} />
                <span className="text-sm text-gray-500">hours</span>
              </div>
            )}
          </Field>
        </section>

        <section className="space-y-4 border-t border-gray-200 pt-5">
          <div>
            <h3 className="section-title">Sending safeguards</h3>
            <p className="mt-0.5 text-xs text-gray-500">Protect your number's quality rating and avoid messaging limits.</p>
          </div>

          <Field
            label="WhatsApp daily conversation limit"
            hint="Your messaging limit from WhatsApp Manager (e.g. 250, 2000, 10000). Bulk send warns before exceeding it and can split a campaign across days. 0 turns the check off."
          >
            {(id) => (
              <input id={id} type="number" min="0" step="1" className="input w-36 tabular-nums" value={form.dailyConversationLimit} onChange={(e) => set("dailyConversationLimit")(e.target.value)} />
            )}
          </Field>

          <Field
            label="Skip contacts messaged by a campaign within"
            hint="Default for Bulk send, so nobody gets several campaigns in a row. 0 turns it off."
          >
            {(id) => (
              <div className="flex items-center gap-2">
                <input id={id} type="number" min="0" max="60" step="1" className="input w-24 tabular-nums" value={form.campaignCooldownDays} onChange={(e) => set("campaignCooldownDays")(e.target.value)} />
                <span className="text-sm text-gray-500">days</span>
              </div>
            )}
          </Field>

          <Toggle
            checked={form.quietHoursEnabled}
            onChange={set("quietHoursEnabled")}
            label="Quiet hours"
            description="Hold campaign messages overnight and send them when quiet hours end. Chats and auto-replies are not affected."
          />
          {form.quietHoursEnabled && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="From">
                {(id) => <input id={id} type="time" className="input" value={form.quietHoursStart} onChange={(e) => set("quietHoursStart")(e.target.value)} />}
              </Field>
              <Field label="Until">
                {(id) => <input id={id} type="time" className="input" value={form.quietHoursEnd} onChange={(e) => set("quietHoursEnd")(e.target.value)} />}
              </Field>
              <Field label="Timezone">
                {(id) => (
                  <select id={id} className="input" value={form.quietHoursTimezone} onChange={(e) => set("quietHoursTimezone")(e.target.value)}>
                    {[form.quietHoursTimezone, "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York", "UTC"]
                      .filter((tz, i, all) => tz && all.indexOf(tz) === i)
                      .map((tz) => (
                        <option key={tz} value={tz}>
                          {tz}
                        </option>
                      ))}
                  </select>
                )}
              </Field>
            </div>
          )}
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
            checked={form.webhookSignatureLocked || form.validateWebhookSignature}
            onChange={set("validateWebhookSignature")}
            disabled={form.webhookSignatureLocked}
            label="Verify webhook signatures"
            description={
              form.webhookSignatureLocked
                ? "Always on in production. Rejects delivery updates and replies that aren't signed by Twilio."
                : "Rejects delivery updates and replies that aren't signed by Twilio. Only turn off for local testing."
            }
          />

          <Field label="Sending rate" hint="Messages per second for bulk campaigns (0.1 to 10). Keep it low for new numbers.">
            {(id) => (
              <input
                id={id}
                type="number"
                min="0.1"
                max="10"
                step="0.1"
                className="input w-32 tabular-nums"
                value={form.sendingRate}
                onChange={(e) => set("sendingRate")(e.target.value)}
              />
            )}
          </Field>
        </section>
      </form>
      )}
    </Dialog>
  );
}
