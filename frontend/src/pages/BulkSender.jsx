import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Maximize2, Send, Upload, Users, X } from "lucide-react";
import { campaignPreflight, getContacts, getContactSets, getTemplates, sendBulkMessages, syncTemplateStatus, uploadMediaFile } from "../services/api";
import { useSocket } from "../context/SocketContext";
import { Badge, Dialog, EmptyState, ErrorState, Field, LoadingRows, PageHeader, SegmentedControl, Spinner } from "../components/ui";
import { useConfirm, useToast } from "../components/feedback";
import { useSettings } from "../components/SettingsDialog";
import ImportContactsDialog from "../components/ImportContactsDialog";
import WhatsAppPreview from "../components/WhatsAppPreview";
import { BUILT_IN_SETS, STATUS_LABELS, customSetsFrom, formatSetName } from "../lib/contacts";
import { errorMessage, formatDateTime, formatNumber } from "../lib/format";

const SAMPLE_NAME = "John Doe";
const SAMPLE_PHONE = "+919876543210";

const getTemplateVariables = (tpl) => {
  if (!tpl) return [];
  if (tpl.variables && tpl.variables.length > 0) return tpl.variables;
  const regex = /\{\{(\d+)\}\}/g;
  const vars = [];
  let match;
  while ((match = regex.exec(tpl.body)) !== null) {
    if (!vars.includes(match[1])) vars.push(match[1]);
  }
  return vars.sort((a, b) => Number(a) - Number(b));
};

const findTemplate = (templates, key) =>
  templates.find((t) => t.content_sid === key || t.name === key || (t._id || t.id) === key);

const isOptedOut = (c) => c.isActive === false || c.consentStatus === "opted_out";
const hasConsent = (c) => c.consentStatus === "opted_in";

// Contacts "Select all" picks: never opted-out, not known-unreachable, and
// (when required) only those with recorded consent.
const isEligible = (c, requireConsent) => !isOptedOut(c) && !c.invalidReason && (!requireConsent || hasConsent(c));

// Explains, reason by reason, why none of the selected contacts can be sent
// the campaign, and what to change.
function NobodyToSend({ pre }) {
  const plural = (n, one, many) => `${formatNumber(n)} ${n === 1 ? one : many}`;
  const reasons = [
    pre.recentlyContacted > 0 &&
      `${plural(pre.recentlyContacted, "contact was", "contacts were")} already sent a campaign in the last ${plural(pre.cooldownDays, "day", "days")}. To send to them again, set "Skip contacts messaged by a campaign in the last … days" under Recipient safeguards to 0.`,
    pre.optedOut > 0 && `${plural(pre.optedOut, "contact has", "contacts have")} opted out (replied STOP) and can't be messaged.`,
    pre.noConsent > 0 &&
      `${plural(pre.noConsent, "contact has", "contacts have")} no recorded consent. Untick "Only contacts with recorded consent", or record their consent on the Contacts page.`,
    pre.invalidFormat > 0 && `${plural(pre.invalidFormat, "number is", "numbers are")} not a valid phone number.`,
  ].filter(Boolean);

  return (
    <div>
      <p className="font-medium">None of the selected contacts can be sent this campaign:</p>
      <ul className="mt-1 list-disc space-y-1 pl-4">
        {reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

// Rows for the pre-send summary.
function PreflightSummary({ pre, count, type, templateLabel, campaignName, hasImage, splitChoice, quietDelay }) {
  const skipped = [
    [pre.optedOut, "opted out (never messaged)"],
    [pre.recentlyContacted, `messaged by a campaign in the last ${pre.cooldownDays} day${pre.cooldownDays === 1 ? "" : "s"}`],
    [pre.noConsent, "without recorded consent"],
    [pre.invalidFormat, "with an invalid number"],
  ].filter(([n]) => n > 0);

  const limit = pre.dailyLimit?.limit || 0;
  const remaining = pre.dailyLimit?.remaining;
  const overLimit = type === "template" && limit > 0 && remaining !== null && pre.willSend > remaining;

  return (
    <div className="space-y-3">
      <dl className="divide-y divide-gray-100 rounded-md border border-gray-200">
        {[
          ["Campaign", campaignName],
          ["Message", type === "template" ? `Template: ${templateLabel}` : "Free text"],
          ...(hasImage ? [["Image", "Attached"]] : []),
          ["Selected", formatNumber(count)],
          ["Will be sent", formatNumber(pre.willSend)],
          ["Starts", pre.delayedByQuietHours ? `${formatDateTime(pre.startsAt)} (after quiet hours)` : formatDateTime(pre.startsAt)],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 px-3 py-2">
            <dt className="shrink-0 text-gray-500">{k}</dt>
            <dd className="min-w-0 break-words text-right font-medium text-gray-900">{v}</dd>
          </div>
        ))}
      </dl>

      {quietDelay && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-13 text-amber-900">
          It's quiet hours ({pre.quietHours?.start}–{pre.quietHours?.end}), so this campaign is scheduled for {formatDateTime(pre.startsAt)}.
          Night-time messages get more blocks and reports. If it's urgent, choose <strong className="font-semibold">Send now anyway</strong>.
        </p>
      )}

      {skipped.length > 0 && (
        <div className="rounded-md bg-gray-50 px-3 py-2 text-13">
          <p className="font-medium text-gray-900">Left out automatically</p>
          <ul className="mt-1 space-y-0.5 text-gray-600">
            {skipped.map(([n, why]) => (
              <li key={why}>
                {formatNumber(n)} {why}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pre.withoutConsent > 0 && pre.noConsent === 0 && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-13 text-amber-900">
          {formatNumber(pre.withoutConsent)} of these contacts have no recorded consent. Messaging people who didn't opt in leads to
          blocks, a lower quality rating and lower limits.
        </p>
      )}
      {pre.notOnWhatsApp > 0 && (
        <p className="text-13 text-gray-600">{formatNumber(pre.notOnWhatsApp)} previously failed as not on WhatsApp and may fail again.</p>
      )}

      {type === "template" && limit > 0 && (
        <p className="text-13 text-gray-600">
          Daily limit: about {formatNumber(pre.dailyLimit.used)} of {formatNumber(limit)} new conversations used in the last 24 hours.
        </p>
      )}
      {type === "template" && limit === 0 && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-13 text-amber-900">
          Your WhatsApp daily limit isn't set, so this campaign can't be checked against it. Set it in Settings (from WhatsApp
          Manager) so large campaigns are split across days instead of failing.
        </p>
      )}
      {overLimit && (
        <fieldset className="space-y-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-13 text-amber-900">
          <legend className="sr-only">Daily limit</legend>
          <p className="font-medium">This campaign is larger than what's left of today's limit ({formatNumber(remaining)}).</p>
          <label className="flex items-start gap-2">
            <input type="radio" name="split" defaultChecked onChange={() => (splitChoice.split = true)} className="mt-0.5 accent-brand-600" />
            <span>
              Send {formatNumber(remaining)} now and the rest in daily batches of {formatNumber(limit)} (recommended)
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="split" onChange={() => (splitChoice.split = false)} className="mt-0.5 accent-brand-600" />
            <span>Send all now. About {formatNumber(pre.willSend - remaining)} are likely to fail and may hurt the quality rating.</span>
          </label>
        </fieldset>
      )}
    </div>
  );
}

export default function BulkSender() {
  const { socket, connected } = useSocket();
  const toast = useToast();
  const confirm = useConfirm();
  const { settings, loaded: settingsLoaded } = useSettings();
  const [requireConsent, setRequireConsent] = useState(false);
  const [cooldownDays, setCooldownDays] = useState(null);
  const activeCampaignRef = useRef(null);

  // Start from the configured cooldown once settings load.
  useEffect(() => {
    if (cooldownDays === null && settingsLoaded) {
      setCooldownDays(Number(settings.campaignCooldownDays) || 0);
    }
  }, [settings, settingsLoaded, cooldownDays]);

  const [contacts, setContacts] = useState([]);
  const [selectedPhones, setSelectedPhones] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [msgType, setMsgType] = useState("template");
  const [freeText, setFreeText] = useState("");
  const [filterSet, setFilterSet] = useState("all");
  const [filterLabel, setFilterLabel] = useState("all");
  const [customSets, setCustomSets] = useState([]);
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [contactsError, setContactsError] = useState("");
  const [campaignMedia, setCampaignMedia] = useState(null);
  const [campaignMediaUrl, setCampaignMediaUrl] = useState("");
  const [uploadingMedia, setUploadingMedia] = useState(false);
  // Final value per template variable: "{{contact_name}}", "{{contact_phone}}" or custom text.
  const [varValues, setVarValues] = useState({});
  // Which source each variable uses, so "Custom text" keeps its input visible while empty.
  const [varSources, setVarSources] = useState({});
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledTime, setScheduledTime] = useState("");
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const mediaInputRef = useRef(null);

  useEffect(() => {
    setVarValues({});
    setVarSources({});
  }, [selectedTemplate]);

  const selectedTpl = msgType === "template" ? findTemplate(templates, selectedTemplate) : null;
  const templateVars = getTemplateVariables(selectedTpl);

  // Template body for the on-screen preview: dynamic variables show sample data.
  const renderTemplateBodyPreview = (tpl) => {
    if (!tpl || !tpl.body) return "";
    let bodyText = tpl.body;
    getTemplateVariables(tpl).forEach((v) => {
      const val = varValues[v];
      let replacement = `{{${v}}}`;
      if (val === "{{contact_name}}") replacement = SAMPLE_NAME;
      else if (val === "{{contact_phone}}") replacement = SAMPLE_PHONE;
      else if (val && val.trim() !== "") replacement = val;
      bodyText = bodyText.replace(new RegExp(`\\{\\{${v}\\}\\}`, "g"), replacement);
    });
    return bodyText
      .replace(/\{\{name\}\}/gi, SAMPLE_NAME)
      .replace(/\{\{phone\}\}/gi, SAMPLE_PHONE)
      .replace(/\{\{contact_name\}\}/gi, SAMPLE_NAME)
      .replace(/\{\{contact_phone\}\}/gi, SAMPLE_PHONE);
  };

  // Template body sent to the server: dynamic variables stay as
  // {{contact_name}} / {{contact_phone}} so each recipient's own details are
  // filled in when the message is sent. (Sending the preview text would store
  // the sample name for every recipient.)
  const renderTemplateBodyForSend = (tpl) => {
    if (!tpl || !tpl.body) return "";
    let bodyText = tpl.body;
    getTemplateVariables(tpl).forEach((v) => {
      const val = varValues[v];
      const replacement = val && val.trim() !== "" ? val.replace(/[\r\n]+/g, " ").trim() : `{{${v}}}`;
      bodyText = bodyText.replace(new RegExp(`\\{\\{${v}\\}\\}`, "g"), replacement);
    });
    return bodyText;
  };

  const loadContactSets = useCallback(async () => {
    try {
      const res = await getContactSets();
      setCustomSets(customSetsFrom(res.data?.sets || {}));
    } catch (err) {
      console.error("Failed to load contact sets:", err);
    }
  }, []);

  const loadContacts = useCallback(async () => {
    setLoadingContacts(true);
    setContactsError("");
    try {
      // Page through the whole set — campaigns must reach everyone in it.
      // (The backend enforces a per-campaign maximum with a clear error.)
      const pageLimit = 1000;
      const baseParams = {
        set: filterSet !== "all" ? filterSet : undefined,
        label: filterLabel !== "all" ? filterLabel : undefined,
      };
      let page = 1;
      let all = [];
      let total = Infinity;
      while (all.length < total && page <= 200) {
        const res = await getContacts({ ...baseParams, page, limit: pageLimit });
        const batch = res.data.contacts || [];
        total = typeof res.data.total === "number" ? res.data.total : all.length + batch.length;
        all = all.concat(batch);
        if (batch.length < pageLimit) break;
        page++;
      }
      setContacts(all);
      // Nothing is pre-selected: recipients are always an explicit choice.
      setSelectedPhones([]);
    } catch (err) {
      console.error(err);
      setContactsError("Contacts could not be loaded.");
    } finally {
      setLoadingContacts(false);
    }
  }, [filterSet, filterLabel]);

  const loadTemplates = useCallback(async () => {
    try {
      const res = await getTemplates();
      const map = new Map();
      (res.data?.data || []).forEach((t) => {
        const sidKey = t.content_sid || t.contentSid;
        const nameKey = t.name ? t.name.trim().toLowerCase() : null;
        const key = sidKey || nameKey || t._id || t.id;
        if (!map.has(key)) map.set(key, t);
        else if (!map.get(key).content_sid && sidKey) map.set(key, t);
      });
      setTemplates(Array.from(map.values()));
    } catch (err) {
      console.warn("Templates not available:", err.message);
    }
  }, []);

  useEffect(() => {
    loadContactSets();
    loadTemplates();
  }, [loadContactSets, loadTemplates]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  useEffect(() => {
    if (!socket) return;
    const isActive = (data) => !activeCampaignRef.current || data.campaignId === activeCampaignRef.current;
    const onProgress = (data) => {
      if (isActive(data)) setProgress(data);
    };
    const onComplete = (data) => {
      if (!isActive(data)) return;
      activeCampaignRef.current = null;
      setSending(false);
      setProgress(null);
      setError("");
      toast.success(`Campaign complete: ${formatNumber(data.sentCount)} sent, ${formatNumber(data.failedCount)} failed.`);
    };
    // The campaign this page started was paused (manually or by the safety
    // check) or cancelled.
    const onUpdate = (data) => {
      if (!activeCampaignRef.current || data.campaignId !== activeCampaignRef.current) return;
      if (data.status !== "paused" && data.status !== "cancelled") return;
      activeCampaignRef.current = null;
      setSending(false);
      setProgress(null);
      toast.error(`Campaign ${data.status}. ${data.statusReason || "See Campaigns for details."}`, { duration: 12000 });
    };
    socket.on("campaign_progress", onProgress);
    socket.on("campaign_complete", onComplete);
    socket.on("campaign_update", onUpdate);
    // A template's WhatsApp approval changed (automatic check or another tab).
    const onTemplateUpdate = (data) => {
      loadTemplates();
      if (data?.status === "approved") toast.success(`Template "${data.name}" is now approved and ready to send.`);
    };
    socket.on("template_update", onTemplateUpdate);
    return () => {
      socket.off("campaign_progress", onProgress);
      socket.off("campaign_complete", onComplete);
      socket.off("campaign_update", onUpdate);
      socket.off("template_update", onTemplateUpdate);
    };
  }, [socket, toast, loadTemplates]);

  const handleMediaUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingMedia(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await uploadMediaFile(fd);
      setCampaignMediaUrl(res.data.mediaUrl);
      setCampaignMedia(file);
    } catch (err) {
      toast.error(`Image upload failed: ${errorMessage(err)}`);
    } finally {
      setUploadingMedia(false);
    }
  };

  const [checkingTemplate, setCheckingTemplate] = useState(false);
  // Asks Twilio for the template's latest WhatsApp approval status.
  const checkTemplateStatus = async () => {
    if (!selectedTpl) return;
    setCheckingTemplate(true);
    try {
      const res = await syncTemplateStatus(selectedTpl._id || selectedTpl.id);
      await loadTemplates();
      if (res.data?.status === "approved") {
        setError("");
        toast.success("Template approved. You can send it now.");
      } else {
        toast.info(`Still "${res.data?.status || "pending"}". WhatsApp hasn't confirmed it to Twilio yet; try again in a few minutes.`);
      }
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't check the template status."));
    } finally {
      setCheckingTemplate(false);
    }
  };

  const toggleSelect = (contact) => {
    if (isOptedOut(contact)) return;
    setSelectedPhones((prev) => (prev.includes(contact.phone) ? prev.filter((p) => p !== contact.phone) : [...prev, contact.phone]));
  };

  const eligibleContacts = contacts.filter((c) => isEligible(c, requireConsent));

  // Requiring consent drops already-selected contacts that don't have it.
  useEffect(() => {
    if (!requireConsent) return;
    const allowed = new Set(contacts.filter(hasConsent).map((c) => c.phone));
    setSelectedPhones((prev) => prev.filter((p) => allowed.has(p)));
  }, [requireConsent, contacts]);

  const setVariableSource = (v, source) => {
    setVarSources((prev) => ({ ...prev, [v]: source }));
    setVarValues((prev) => ({ ...prev, [v]: source === "static" || source === "" ? "" : `{{${source}}}` }));
  };

  // Validates the form and builds the API payload, or returns an error.
  const prepareSend = () => {
    if (selectedPhones.length === 0) return { error: "Select at least one contact." };

    let templateNameToSend;
    let paramsToSend = [];

    if (msgType === "template") {
      if (!selectedTemplate) return { error: "Select a template." };
      if (selectedTpl) {
        templateNameToSend = selectedTpl.content_sid || selectedTpl.contentSid || selectedTpl.name;
        for (const v of templateVars) {
          const val = varValues[v];
          if (!val || val.trim() === "") return { error: `Provide a value for variable {{${v}}}.` };
        }
        paramsToSend = templateVars.map((v) => (varValues[v] || "").replace(/[\r\n]+/g, " ").trim());
      } else {
        templateNameToSend = selectedTemplate;
      }
    }

    if (msgType === "text" && !freeText.trim() && !campaignMediaUrl) {
      return { error: "Write a message or attach an image." };
    }

    let scheduledAtISO;
    if (isScheduled) {
      if (!scheduledTime) return { error: "Choose a date and time for the scheduled campaign." };
      const schedDate = new Date(scheduledTime);
      if (Number.isNaN(schedDate.getTime()) || schedDate <= new Date()) {
        return { error: "The scheduled time must be in the future." };
      }
      scheduledAtISO = schedDate.toISOString();
    }

    const messageTextToSend = msgType === "text" ? freeText : selectedTpl ? renderTemplateBodyForSend(selectedTpl) : freeText;

    return {
      payload: {
        phones: selectedPhones,
        templateName: templateNameToSend,
        message: messageTextToSend || undefined,
        campaignName: campaignName || `Campaign ${new Date().toLocaleDateString()}`,
        type: msgType,
        params: paramsToSend,
        mediaUrl: campaignMediaUrl || undefined,
        scheduledAt: scheduledAtISO,
        skipRecentDays: cooldownDays ?? undefined,
        requireConsent,
      },
    };
  };

  const handleSend = async () => {
    const { error: validationError, payload } = prepareSend();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");

    const count = selectedPhones.length;

    // Ask the server what will actually happen: who is left out and why,
    // daily-limit usage, and when sending starts (quiet hours).
    let pre;
    setChecking(true);
    try {
      const res = await campaignPreflight({
        phones: payload.phones,
        templateName: payload.templateName,
        type: payload.type,
        skipRecentDays: payload.skipRecentDays,
        requireConsent: payload.requireConsent,
        scheduledAt: payload.scheduledAt,
      });
      pre = res.data;
    } catch (err) {
      setError(errorMessage(err, "Could not check the campaign before sending."));
      return;
    } finally {
      setChecking(false);
    }

    if (pre.templateBlocked) {
      setError(pre.templateBlocked);
      loadTemplates();
      return;
    }

    if (pre.willSend === 0) {
      setError(<NobodyToSend pre={pre} />);
      return;
    }

    const splitChoice = { split: true };
    // During quiet hours (and not deliberately scheduled), offer an override
    // for urgent campaigns next to the default "schedule for the morning".
    const quietDelay = pre.delayedByQuietHours && !isScheduled;
    const choice = await confirm({
      title: isScheduled || pre.delayedByQuietHours ? "Schedule this campaign?" : "Send this campaign now?",
      confirmLabel:
        isScheduled || pre.delayedByQuietHours ? `Schedule for ${formatNumber(pre.willSend)}` : `Send to ${formatNumber(pre.willSend)}`,
      secondaryLabel: quietDelay ? "Send now anyway" : undefined,
      message: (
        <PreflightSummary
          pre={pre}
          count={count}
          type={msgType}
          templateLabel={selectedTpl?.name || selectedTemplate}
          campaignName={payload.campaignName}
          hasImage={Boolean(campaignMediaUrl)}
          splitChoice={splitChoice}
          quietDelay={quietDelay}
        />
      ),
    });
    if (!choice) return;
    const sendNowAnyway = choice === "secondary";
    const startsLater = isScheduled || (pre.delayedByQuietHours && !sendNowAnyway);

    setSending(true);
    try {
      const res = await sendBulkMessages({ ...payload, splitAcrossDays: splitChoice.split, ignoreQuietHours: sendNowAnyway });
      const data = res.data || {};
      activeCampaignRef.current = data.campaignId || null;
      const queued = data.queued ?? pre.willSend;
      const notes = [
        data.failed ? `${formatNumber(data.failed)} not sent (opted out or invalid)` : "",
        data.skippedRecent ? `${formatNumber(data.skippedRecent)} skipped as recently messaged` : "",
        data.batches > 1 ? `split into ${data.batches} daily batches` : "",
      ].filter(Boolean);

      if (queued === 0) {
        setSending(false);
        toast.error(`No messages were queued. ${notes.join("; ")}.`);
        return;
      }

      if (startsLater || (data.startsAt && new Date(data.startsAt) > new Date(Date.now() + 60000))) {
        setSending(false);
        toast.success(
          `Campaign scheduled for ${formatDateTime(data.startsAt || scheduledTime)}: ${formatNumber(queued)} queued${notes.length ? `; ${notes.join("; ")}` : ""}.`
        );
        setIsScheduled(false);
        setScheduledTime("");
        setCampaignName("");
        return;
      }

      toast.info(`Campaign started: ${formatNumber(queued)} queued${notes.length ? `; ${notes.join("; ")}` : ""}.`);
      // Progress arrives over the live connection; without it, follow up in Campaigns.
      if (!connected) setSending(false);
    } catch (err) {
      setError(errorMessage(err, "The campaign could not be started."));
      setSending(false);
    }
  };

  const allSelected = eligibleContacts.length > 0 && eligibleContacts.every((c) => selectedPhones.includes(c.phone));
  const optedOutCount = contacts.filter(isOptedOut).length;
  const previewBody = msgType === "template" ? renderTemplateBodyPreview(selectedTpl) : freeText.replace(/\{\{name\}\}/gi, SAMPLE_NAME).replace(/\{\{phone\}\}/gi, SAMPLE_PHONE);
  const previewImage = campaignMediaUrl || selectedTpl?.header_image_url || selectedTpl?.headerImageUrl || "";
  const setOptions = [...BUILT_IN_SETS.map((s) => s.value), ...customSets];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader title="Bulk send" description="Choose recipients, compose the message, and send or schedule." />

      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        {/* Recipients */}
        <section aria-label="Recipients" className="flex flex-col border-b border-gray-200 lg:min-h-0 lg:flex-1 lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-3 sm:px-6 lg:px-8">
            <select aria-label="Contact set" value={filterSet} onChange={(e) => setFilterSet(e.target.value)} className="input w-auto">
              <option value="all">All contacts</option>
              {setOptions.map((s) => (
                <option key={s} value={s}>
                  {formatSetName(s)}
                </option>
              ))}
            </select>
            <select aria-label="Status label" value={filterLabel} onChange={(e) => setFilterLabel(e.target.value)} className="input w-auto">
              <option value="all">Any status</option>
              {STATUS_LABELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-secondary ml-auto" onClick={() => setImportOpen(true)}>
              <Upload size={14} aria-hidden="true" />
              Import
            </button>
          </div>

          {contactsError && (
            <div className="px-4 pt-3 sm:px-6 lg:px-8">
              <ErrorState message={contactsError} onRetry={loadContacts} />
            </div>
          )}

          <div className="relative max-h-[55vh] min-h-[240px] flex-1 overflow-y-auto lg:max-h-none">
            <table className="table">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="w-10 pl-4 sm:pl-6 lg:pl-8">
                    <input
                      type="checkbox"
                      className="checkbox"
                      aria-label="Select all eligible recipients"
                      checked={allSelected}
                      onChange={() => setSelectedPhones(allSelected ? [] : eligibleContacts.map((c) => c.phone))}
                    />
                  </th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Set / label</th>
                  <th>Consent</th>
                </tr>
              </thead>
              <tbody>
                {loadingContacts ? (
                  <LoadingRows rows={6} cols={5} />
                ) : contacts.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="h-auto">
                      <EmptyState
                        icon={Users}
                        title="No contacts in this selection"
                        description="Choose another set or import contacts."
                        action={
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setImportOpen(true)}>
                            Import contacts
                          </button>
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  contacts.map((c) => {
                    const checked = selectedPhones.includes(c.phone);
                    const blocked = isOptedOut(c);
                    const consentLocked = requireConsent && !hasConsent(c) && !blocked;
                    const disabled = blocked || consentLocked;
                    return (
                      <tr
                        key={c._id}
                        onClick={() => !disabled && toggleSelect(c)}
                        className={disabled ? "text-gray-400" : `cursor-pointer ${checked ? "bg-brand-50/40" : "hover:bg-gray-50"}`}
                      >
                        <td className="pl-4 sm:pl-6 lg:pl-8">
                          <input
                            type="checkbox"
                            className="checkbox disabled:cursor-not-allowed"
                            aria-label={`Select ${c.name}`}
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggleSelect(c)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className={`whitespace-nowrap ${disabled ? "" : "text-gray-900"}`}>{c.name}</td>
                        <td className="num whitespace-nowrap">{c.phone}</td>
                        <td className={disabled ? "" : "text-gray-500"}>{c.label && c.label !== "none" ? formatSetName(c.label) : "—"}</td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {blocked ? (
                              <Badge tone="danger">Opted out</Badge>
                            ) : hasConsent(c) ? (
                              <Badge tone="success">Opted in</Badge>
                            ) : (
                              <Badge>Not recorded</Badge>
                            )}
                            {c.invalidReason && <Badge tone="warning">Not on WhatsApp</Badge>}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-2.5 text-13 sm:px-6 lg:px-8">
            <span className="tabular-nums text-gray-600">
              <strong className="font-semibold text-gray-900">{formatNumber(selectedPhones.length)}</strong> of {formatNumber(contacts.length)} selected
              {optedOutCount > 0 && <span className="text-gray-400"> · {formatNumber(optedOutCount)} opted out</span>}
            </span>
            <button
              type="button"
              className="font-medium text-brand-700 hover:text-brand-800 disabled:text-gray-400"
              onClick={() => setSelectedPhones(allSelected ? [] : eligibleContacts.map((c) => c.phone))}
              disabled={eligibleContacts.length === 0}
              title="Selects everyone who can be messaged: not opted out, not known to be unreachable"
            >
              {allSelected ? "Clear selection" : `Select all eligible (${formatNumber(eligibleContacts.length)})`}
            </button>
          </div>
        </section>

        {/* Compose */}
        <aside aria-label="Compose campaign" className="relative flex shrink-0 flex-col bg-white lg:w-[420px] lg:overflow-y-auto">
          <div className="flex-1 space-y-5 px-4 py-5 sm:px-6">
            <Field label="Campaign name" hint="Shown in Campaigns. Defaults to today's date.">
              {(id) => <input id={id} className="input" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="e.g. July promotion" />}
            </Field>

            <div>
              <span className="label">Message type</span>
              <SegmentedControl
                label="Message type"
                value={msgType}
                onChange={setMsgType}
                options={[
                  { value: "template", label: "Template" },
                  { value: "text", label: "Free text" },
                ]}
              />
              <p className="hint">
                {msgType === "template"
                  ? "Required for contacts who haven't messaged you in the last 24 hours."
                  : "Only delivered to contacts who messaged you in the last 24 hours."}
              </p>
            </div>

            {msgType === "template" ? (
              <div className="space-y-4">
                {templates.length > 0 ? (
                  <Field label="Template">
                    {(id) => (
                      <select
                        id={id}
                        className="input"
                        value={selectedTemplate}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSelectedTemplate(val);
                          const tpl = findTemplate(templates, val);
                          if (tpl && (tpl.header_image_url || tpl.headerImageUrl)) {
                            setCampaignMediaUrl(tpl.header_image_url || tpl.headerImageUrl);
                          }
                        }}
                      >
                        <option value="">Select a template</option>
                        {templates.map((t) => (
                          <option key={t._id || t.id} value={t._id || t.id} disabled={t.status?.toLowerCase() === "rejected"}>
                            {t.name} ({t.status || "draft"}){t.type === "media" || t.header_image_url ? " · image" : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                ) : (
                  <Field label="Template name" hint="Enter the exact name of an approved template.">
                    {(id) => <input id={id} className="input" value={selectedTemplate} onChange={(e) => setSelectedTemplate(e.target.value)} />}
                  </Field>
                )}

                {selectedTpl && selectedTpl.status !== "approved" && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-13 text-amber-900">
                    <p>
                      {selectedTpl.status === "rejected"
                        ? "WhatsApp rejected this template. Edit and resubmit it on the Templates page."
                        : selectedTpl.content_sid || selectedTpl.contentSid
                          ? "This template is waiting for WhatsApp approval and can't be sent yet. If Meta's approval email has arrived, it can take a few minutes to show here. The app re-checks every 10 minutes."
                          : "This template hasn't been submitted for WhatsApp approval yet. Submit it on the Templates page first."}
                    </p>
                    {(selectedTpl.content_sid || selectedTpl.contentSid) && selectedTpl.status !== "rejected" && (
                      <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={checkTemplateStatus} disabled={checkingTemplate}>
                        {checkingTemplate ? "Checking…" : "Check status now"}
                      </button>
                    )}
                  </div>
                )}

                {selectedTpl && templateVars.length > 0 && (
                  <fieldset className="space-y-3">
                    <legend className="mb-2 text-sm font-medium text-gray-700">Variables</legend>
                    {templateVars.map((v) => {
                      const source = varSources[v] || "";
                      return (
                        <div key={v} className="grid grid-cols-[72px_1fr] items-start gap-2">
                          <span className="pt-2 font-mono text-xs text-gray-600">{`{{${v}}}`}</span>
                          <div className="space-y-2">
                            <select aria-label={`Source for variable ${v}`} className="input input-sm" value={source} onChange={(e) => setVariableSource(v, e.target.value)}>
                              <option value="">Choose a value…</option>
                              <option value="contact_name">Contact name</option>
                              <option value="contact_phone">Contact phone</option>
                              <option value="static">Custom text</option>
                            </select>
                            {source === "static" && (
                              <input
                                aria-label={`Custom text for variable ${v}`}
                                className="input input-sm"
                                value={varValues[v] || ""}
                                onChange={(e) => setVarValues((prev) => ({ ...prev, [v]: e.target.value }))}
                                placeholder="Same text for every contact"
                                autoFocus
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </fieldset>
                )}
              </div>
            ) : (
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label htmlFor="free-text" className="text-sm font-medium text-gray-700">
                    Message
                  </label>
                  <div className="flex gap-1">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFreeText((prev) => `${prev}${prev && !prev.endsWith(" ") ? " " : ""}{{name}}`)}>
                      + Name
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFreeText((prev) => `${prev}${prev && !prev.endsWith(" ") ? " " : ""}{{phone}}`)}>
                      + Phone
                    </button>
                  </div>
                </div>
                <textarea
                  id="free-text"
                  rows={5}
                  className="input resize-y"
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value)}
                  placeholder="Hello {{name}}, you're invited to…"
                />
                <p className="hint">{"{{name}}"} and {"{{phone}}"} are replaced with each recipient's details.</p>
              </div>
            )}

            {(selectedTpl || msgType === "text") && (
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Preview</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowPreviewModal(true)}>
                    <Maximize2 size={13} aria-hidden="true" />
                    Full screen
                  </button>
                </div>
                <WhatsAppPreview body={previewBody} headerImageUrl={previewImage} buttons={selectedTpl?.buttons || []} />
              </div>
            )}

            <div>
              <span className="label">{msgType === "template" ? "Header image" : "Image (optional)"}</span>
              {campaignMediaUrl ? (
                <div className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2">
                  <ImagePlus size={16} className="shrink-0 text-gray-400" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-13 text-gray-700" title={campaignMediaUrl}>
                    {campaignMedia?.name || "Image from template"}
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => mediaInputRef.current?.click()} disabled={uploadingMedia}>
                    Change
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-icon"
                    aria-label="Remove image"
                    onClick={() => {
                      setCampaignMedia(null);
                      setCampaignMediaUrl("");
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button type="button" className="btn btn-secondary" onClick={() => mediaInputRef.current?.click()} disabled={uploadingMedia}>
                  {uploadingMedia ? <Spinner size={14} /> : <ImagePlus size={14} aria-hidden="true" />}
                  {uploadingMedia ? "Uploading…" : "Attach image"}
                </button>
              )}
              <input ref={mediaInputRef} type="file" accept="image/*" onChange={handleMediaUpload} className="sr-only" />
            </div>

            <div>
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-700">
                <input type="checkbox" className="checkbox" checked={isScheduled} onChange={(e) => setIsScheduled(e.target.checked)} />
                Schedule for later
              </label>
              {isScheduled && (
                <div className="mt-2">
                  <input
                    aria-label="Scheduled date and time"
                    type="datetime-local"
                    className="input"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                  />
                  <p className="hint">Messages wait in the queue and start sending at this time.</p>
                </div>
              )}
            </div>

            <fieldset className="space-y-3 border-t border-gray-200 pt-4">
              <legend className="text-sm font-medium text-gray-700">Recipient safeguards</legend>
              <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-700">
                <input type="checkbox" className="checkbox mt-0.5" checked={requireConsent} onChange={(e) => setRequireConsent(e.target.checked)} />
                <span>
                  Only contacts with recorded consent
                  <span className="block text-xs text-gray-500">Recommended for marketing. Record consent on the Contacts page.</span>
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
                <label htmlFor="cooldown-days">Skip contacts messaged by a campaign in the last</label>
                <input
                  id="cooldown-days"
                  type="number"
                  min="0"
                  max="60"
                  className="input input-sm w-16 tabular-nums"
                  value={cooldownDays ?? ""}
                  onChange={(e) => setCooldownDays(Math.max(0, Number(e.target.value) || 0))}
                />
                <span>days</span>
              </div>
              <p className="text-xs text-gray-500">Opted-out contacts are never messaged. Quiet hours and your daily limit are applied automatically (Settings).</p>
            </fieldset>
          </div>

          <div className="sticky bottom-0 space-y-3 border-t border-gray-200 bg-white px-4 py-4 sm:px-6">
            {error && <ErrorState message={error} />}
            {sending && progress && (
              <div>
                <div className="mb-1.5 flex justify-between text-xs text-gray-600">
                  <span className="truncate">Sending… last: {progress.phone}</span>
                  <span className="tabular-nums">{progress.progress}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={progress.progress} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${progress.progress}%` }} />
                </div>
              </div>
            )}
            <button type="button" onClick={handleSend} disabled={sending || checking || selectedPhones.length === 0} className="btn btn-primary w-full">
              {checking ? (
                <>
                  <Spinner size={14} className="text-white" />
                  Checking recipients…
                </>
              ) : sending ? (
                <>
                  <Spinner size={14} className="text-white" />
                  {isScheduled ? "Scheduling…" : "Sending…"}
                </>
              ) : (
                <>
                  <Send size={14} aria-hidden="true" />
                  {isScheduled ? "Schedule" : "Send"} to {formatNumber(selectedPhones.length)} contact{selectedPhones.length === 1 ? "" : "s"}
                </>
              )}
            </button>
          </div>
        </aside>
      </div>

      <Dialog open={showPreviewModal} onClose={() => setShowPreviewModal(false)} title={selectedTpl ? `Preview · ${selectedTpl.name}` : "Preview"} description="Dynamic values show sample data." size="xl">
        <div className="mx-auto max-w-[420px]">
          <WhatsAppPreview body={previewBody} headerImageUrl={previewImage} buttons={selectedTpl?.buttons || []} size="lg" />
        </div>
      </Dialog>

      <ImportContactsDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        defaultSet={filterSet}
        customSets={customSets}
        onImported={() => {
          loadContacts();
          loadContactSets();
        }}
      />
    </div>
  );
}
