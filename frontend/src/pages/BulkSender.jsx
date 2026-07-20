import { useState, useEffect, useRef } from "react";
import {
  Upload,
  Send,
  X,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  Loader2,
  Calendar,
  Clock,
  Sparkles,
} from "lucide-react";
import { uploadContacts, getContacts, getContactSets, getTemplates, sendBulkMessages, uploadMediaFile } from "../services/api";
import { useSocket } from "../context/SocketContext";

const DEFAULT_SETS = [
  { value: "all", label: "🌐 All Contacts" },
  { value: "test_contacts", label: "🧪 Test Contacts" },
  { value: "new_contacts", label: "🆕 Set of New Contacts" },
];

const LABELS = [
  { value: "all", label: "All Status Labels" },
  { value: "interested", label: "Interested" },
  { value: "follow_up", label: "Follow Up" },
  { value: "converted", label: "Converted" },
  { value: "not_interested", label: "Not Interested" },
];

export default function BulkSender() {
  const { socket } = useSocket();
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
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [campaignMedia, setCampaignMedia] = useState(null);
  const [campaignMediaUrl, setCampaignMediaUrl] = useState("");
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [varValues, setVarValues] = useState({});
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledTime, setScheduledTime] = useState("");
  const fileRef = useRef(null);
  const mediaInputRef = useRef(null);

  useEffect(() => {
    setVarValues({});
  }, [selectedTemplate]);

  const getTemplateVariables = (tpl) => {
    if (!tpl) return [];
    if (tpl.variables && tpl.variables.length > 0) return tpl.variables;
    const regex = /\{\{(\d+)\}\}/g;
    const vars = [];
    let match;
    while ((match = regex.exec(tpl.body)) !== null) {
      if (!vars.includes(match[1])) {
        vars.push(match[1]);
      }
    }
    return vars.sort((a, b) => Number(a) - Number(b));
  };

  const handleMediaUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingMedia(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await uploadMediaFile(fd);
      setCampaignMediaUrl(res.data.mediaUrl);
      setCampaignMedia(file);
    } catch (err) {
      alert("Media upload failed: " + (err.response?.data?.error || err.message));
    } finally {
      setUploadingMedia(false);
    }
  };

  useEffect(() => {
    loadContactSets();
    loadTemplates();
  }, []);

  useEffect(() => {
    loadContacts();
  }, [filterSet, filterLabel]);

  const loadContactSets = async () => {
    try {
      const res = await getContactSets();
      const counts = res.data?.sets || {};
      const known = ["all", "test_contacts", "new_contacts", "none", "interested", "follow_up", "converted", "not_interested"];
      const custom = Object.keys(counts).filter((k) => !known.includes(k));
      setCustomSets(custom);
    } catch (err) {
      console.error("Failed to load contact sets:", err);
    }
  };

  useEffect(() => {
    if (!socket) return;
    socket.on("campaign_progress", (data) => {
      setProgress(data);
    });
    socket.on("campaign_complete", (data) => {
      setSending(false);
      setProgress(null);
      setError("");
      alert(`Campaign complete! Sent: ${data.sentCount}, Failed: ${data.failedCount}`);
    });
    return () => {
      socket.off("campaign_progress");
      socket.off("campaign_complete");
    };
  }, [socket]);

  const loadContacts = async () => {
    setLoadingContacts(true);
    try {
      const res = await getContacts({
        set: filterSet !== "all" ? filterSet : undefined,
        label: filterLabel !== "all" ? filterLabel : undefined,
        limit: 500,
      });
      const list = res.data.contacts || [];
      setContacts(list);
      setSelectedPhones(list.map((c) => c.phone));
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingContacts(false);
    }
  };

  const loadTemplates = async () => {
    try {
      const res = await getTemplates();
      setTemplates(res.data?.data || []);
    } catch (err) {
      // Templates might not be available if Meta creds not set
      console.warn("Templates not available:", err.message);
    }
  };

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    setError("");
    const fd = new FormData();
    fd.append("file", file);
    if (filterSet && filterSet !== "all") {
      fd.append("targetSet", filterSet);
    }
    try {
      const res = await uploadContacts(fd);
      setUploadResult(res.data);
      loadContacts();
      loadContactSets();
    } catch (err) {
      setError(err.response?.data?.error || "Upload failed");
    } finally {
      setUploading(false);
      fileRef.current.value = "";
    }
  };

  const toggleSelect = (phone) => {
    setSelectedPhones((prev) =>
      prev.includes(phone) ? prev.filter((p) => p !== phone) : [...prev, phone]
    );
  };

  const selectAll = () => {
    if (selectedPhones.length === contacts.length) {
      setSelectedPhones([]);
    } else {
      setSelectedPhones(contacts.map((c) => c.phone));
    }
  };

  const handleSend = async () => {
    if (selectedPhones.length === 0) return setError("Select at least one contact");
    
    let templateNameToSend = undefined;
    let paramsToSend = [];

    if (msgType === "template") {
      if (!selectedTemplate) return setError("Select a template");
      const tpl = templates.find(t => (t._id || t.id) === selectedTemplate);
      if (tpl) {
        templateNameToSend = tpl.content_sid || tpl.contentSid || tpl.name;
        const vars = getTemplateVariables(tpl);
        paramsToSend = vars.map(v => varValues[v] || "");
      } else {
        templateNameToSend = selectedTemplate;
      }
    }

    if (msgType === "text" && !freeText.trim() && !campaignMediaUrl) {
      return setError("Enter a message text or attach campaign media");
    }

    let scheduledAtISO = undefined;
    if (isScheduled) {
      if (!scheduledTime) return setError("Select a valid date and time to schedule your campaign");
      const schedDate = new Date(scheduledTime);
      if (isNaN(schedDate.getTime()) || schedDate <= new Date()) {
        return setError("Scheduled date and time must be in the future");
      }
      scheduledAtISO = schedDate.toISOString();
    }

    setError("");
    setSending(true);

    try {
      const res = await sendBulkMessages({
        phones: selectedPhones,
        templateName: templateNameToSend,
        message: msgType === "text" ? freeText : undefined,
        campaignName: campaignName || `Campaign ${new Date().toLocaleDateString()}`,
        type: msgType,
        params: paramsToSend,
        mediaUrl: campaignMediaUrl || undefined,
        scheduledAt: scheduledAtISO,
      });

      if (isScheduled) {
        setSending(false);
        const formattedDate = new Date(scheduledTime).toLocaleString();
        alert(`🗓️ Campaign successfully scheduled!\n\nIt will start automatically on ${formattedDate} for ${selectedPhones.length} contacts.`);
        setIsScheduled(false);
        setScheduledTime("");
        setCampaignName("");
      }
    } catch (err) {
      setError(err.response?.data?.error || "Failed to start campaign");
      setSending(false);
    }
  };

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left: Contacts */}
      <div className="flex-1 flex flex-col border-r border-surface-border overflow-hidden bg-white">
        {/* Header */}
        <div className="p-4 border-b border-surface-border flex items-center justify-between gap-3 flex-wrap bg-white">
          <div>
            <h1 className="text-sm font-bold text-slate-900">Bulk Send</h1>
            <p className="text-xs text-slate-500">{contacts.length} contacts loaded</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Contact Set Selector */}
            <div className="relative">
              <select
                value={filterSet}
                onChange={(e) => setFilterSet(e.target.value)}
                className="input pr-8 appearance-none cursor-pointer text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl"
                style={{ width: 185 }}
              >
                {DEFAULT_SETS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
                {customSets.map((cs) => (
                  <option key={cs} value={cs}>🏷️ {cs.replace(/_/g, " ").toUpperCase()}</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>

            {/* Label filter */}
            <div className="relative">
              <select
                value={filterLabel}
                onChange={(e) => setFilterLabel(e.target.value)}
                className="input pr-8 appearance-none cursor-pointer text-xs"
                style={{ width: 140 }}
              >
                {LABELS.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
            {/* Upload */}
            <button
              onClick={() => fileRef.current.click()}
              className="btn-primary"
              disabled={uploading}
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Upload File (CSV/Excel)
            </button>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.xlsb,.xlsm,.ods,.xml,.txt,.tsv,.prn" onChange={handleUpload} className="hidden" />
          </div>
        </div>

        {/* Upload result */}
        {uploadResult && (
          <div className="mx-4 mt-3 p-3 rounded-2xl bg-wa-green/10 border border-wa-green/30 flex items-center justify-between gap-2 animate-fade-in">
            <div className="flex items-center gap-2">
              <CheckCircle size={16} className="text-wa-green shrink-0" />
              <div className="text-xs">
                <span className="font-bold text-slate-800">Uploaded {uploadResult.total} total rows: </span>
                <span className="text-wa-green font-bold">{uploadResult.added} new contacts added</span>
                {uploadResult.duplicates > 0 && (
                  <span className="text-amber-700 font-semibold ml-2">• ⚠️ {uploadResult.duplicates} duplicate numbers updated/skipped</span>
                )}
              </div>
            </div>
            <button onClick={() => setUploadResult(null)} className="text-slate-400 hover:text-slate-600 p-1">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Contacts Table */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#F3FAF4] border-b border-surface-border">
              <tr>
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={selectedPhones.length === contacts.length && contacts.length > 0}
                    onChange={selectAll}
                    className="rounded"
                  />
                </th>
                <th className="px-4 py-3 text-left text-slate-400 font-medium text-xs">Name</th>
                <th className="px-4 py-3 text-left text-slate-400 font-medium text-xs">Phone</th>
                <th className="px-4 py-3 text-left text-slate-400 font-medium text-xs">Label</th>
              </tr>
            </thead>
            <tbody>
              {loadingContacts ? (
                Array(5).fill(0).map((_, i) => (
                  <tr key={i} className="border-b border-surface-border/50">
                    <td className="px-4 py-3" colSpan={4}>
                      <div className="h-4 bg-[#F3FAF4] rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : contacts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-slate-500 text-xs">
                    No contacts. Upload a CSV to get started.
                  </td>
                </tr>
              ) : (
                contacts.map((c) => (
                  <tr
                    key={c._id}
                    onClick={() => toggleSelect(c.phone)}
                    className={`border-b border-surface-border/50 cursor-pointer hover:bg-[#F3FAF4] transition-colors ${
                      selectedPhones.includes(c.phone) ? "bg-wa-green/5" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedPhones.includes(c.phone)}
                        onChange={() => toggleSelect(c.phone)}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded"
                      />
                    </td>
                    <td className="px-4 py-3 text-slate-900 text-xs">{c.name}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs font-mono">{c.phone}</td>
                    <td className="px-4 py-3">
                      {c.label !== "none" && (
                        <span className="badge bg-[#F3FAF4] text-slate-600 text-xs">{c.label.replace("_", " ")}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Selection count */}
        {selectedPhones.length > 0 && (
          <div className="px-4 py-2 border-t border-surface-border bg-white">
            <p className="text-xs text-wa-green">{selectedPhones.length} contacts selected</p>
          </div>
        )}
      </div>

      {/* Right: Compose */}
      <div className="w-80 flex flex-col bg-white overflow-y-auto p-5 gap-5 shadow-sm rounded-3xl">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 mb-4">Compose Campaign</h2>

          {/* Campaign name */}
          <div className="mb-4">
            <label className="block text-xs text-slate-400 mb-1.5">Campaign Name</label>
            <input
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              placeholder="e.g. July Promo"
              className="input"
            />
          </div>

          {/* Message type */}
          <div className="mb-4">
            <label className="block text-xs text-slate-400 mb-1.5">Message Type</label>
            <div className="flex rounded-lg overflow-hidden border border-surface-border">
              {["template", "text"].map((t) => (
                <button
                  key={t}
                  onClick={() => setMsgType(t)}
                  className={`flex-1 py-2 text-xs font-medium transition-colors ${
                    msgType === t
                      ? "bg-wa-green text-slate-900"
                      : "text-slate-600 hover:text-wa-green hover:bg-wa-green/10"
                  }`}
                >
                  {t === "template" ? "Template" : "Free Text"}
                </button>
              ))}
            </div>
          </div>

          {/* Template picker */}
          {msgType === "template" && (
            <div className="mb-4">
              <label className="block text-xs text-slate-400 mb-1.5">Template</label>
              {templates.length > 0 ? (
                <div className="relative mb-3">
                  <select
                    value={selectedTemplate}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedTemplate(val);
                      const tpl = templates.find(t => (t._id || t.id) === val);
                      if (tpl && (tpl.header_image_url || tpl.headerImageUrl)) {
                        setCampaignMediaUrl(tpl.header_image_url || tpl.headerImageUrl);
                      }
                    }}
                    className="input appearance-none pr-8 font-medium text-slate-700"
                  >
                    <option value="">Select template...</option>
                    {templates.map((t) => (
                      <option 
                        key={t._id || t.id} 
                        value={t._id || t.id} 
                        disabled={t.status?.toLowerCase() === "rejected"}
                      >
                        {t.name} ({t.status || "draft"}) {t.type === "media" || t.header_image_url ? "📷" : ""}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              ) : (
                <div className="mb-3">
                  <input
                    value={selectedTemplate}
                    onChange={(e) => setSelectedTemplate(e.target.value)}
                    placeholder="Enter template name exactly"
                    className="input"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Enter the exact approved template name from Meta.
                  </p>
                </div>
              )}

              {/* Dynamic Variable Input Fields */}
              {(() => {
                const tpl = templates.find(t => (t._id || t.id) === selectedTemplate);
                if (!tpl) return null;
                const vars = getTemplateVariables(tpl);
                const isMediaTpl = tpl.type === "media" || !!tpl.header_image_url;

                return (
                  <div className="space-y-2.5 mb-3">
                    {isMediaTpl && (
                      <div className="p-2.5 bg-emerald-50 border border-emerald-200/60 rounded-xl text-[11px] text-emerald-800 flex items-center gap-2">
                        <Sparkles size={12} className="text-emerald-600 shrink-0" />
                        <span>This approved template has an image header. Verify or attach your image URL below.</span>
                      </div>
                    )}

                    {vars.length > 0 && (
                      <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 space-y-2.5">
                        <p className="text-xs font-bold text-slate-600 mb-1 select-none">Template Variables</p>
                        <div className="space-y-2">
                          {vars.map((v) => {
                            const val = varValues[v] || "";
                            const selectVal = val === "{{contact_name}}" || val === "{{contact_phone}}" ? val : (val === "" ? "" : "static");
                            
                            return (
                              <div key={v} className="p-2 bg-white rounded-xl border border-slate-150/65 shadow-sm space-y-1.5">
                                <label className="block text-[10px] font-semibold text-slate-500">Variable {v}</label>
                                
                                <select
                                  value={selectVal}
                                  onChange={(e) => {
                                    const sel = e.target.value;
                                    if (sel === "static") {
                                      setVarValues(prev => ({ ...prev, [v]: "" }));
                                    } else {
                                      setVarValues(prev => ({ ...prev, [v]: sel }));
                                    }
                                  }}
                                  className="input py-1 px-2 text-xs"
                                >
                                  <option value="">Select variable source...</option>
                                  <option value="{{contact_name}}">Contact Name (Dynamic)</option>
                                  <option value="{{contact_phone}}">Contact Phone (Dynamic)</option>
                                  <option value="static">Custom Static Text</option>
                                </select>

                                {selectVal === "static" && (
                                  <input
                                    type="text"
                                    value={val}
                                    onChange={(e) => setVarValues(prev => ({ ...prev, [v]: e.target.value }))}
                                    placeholder={`Enter static text for variable ${v}`}
                                    className="input py-1.5 px-2 text-xs"
                                    required
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Free text */}
          {msgType === "text" && (
            <div className="mb-4">
              <label className="block text-xs text-slate-400 mb-1.5">Message</label>
              <textarea
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                placeholder="Type your message..."
                rows={5}
                className="input resize-none"
              />
              <p className="text-xs text-yellow-400/80 mt-1">
                ⚠ Free text only works for contacts who messaged you within 24 hrs.
              </p>
            </div>
          )}

          {/* Media Attachment */}
          <div className="mb-4">
            <label className="block text-xs text-slate-400 mb-1.5">
              {msgType === "template" ? "Template Header Image / Campaign Media" : "Campaign Media (Optional)"}
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => mediaInputRef.current.click()}
                className="btn-secondary text-xs flex items-center gap-1.5 py-1.5"
                disabled={uploadingMedia}
              >
                {uploadingMedia ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                {campaignMedia || campaignMediaUrl ? "Change Image" : "Attach Image"}
              </button>
              <input
                ref={mediaInputRef}
                type="file"
                accept="image/*"
                onChange={handleMediaUpload}
                className="hidden"
              />
              {(campaignMedia || campaignMediaUrl) && (
                <button
                  type="button"
                  onClick={() => {
                    setCampaignMedia(null);
                    setCampaignMediaUrl("");
                  }}
                  className="text-slate-400 hover:text-red-500 text-xs font-semibold px-1"
                  title="Remove media"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {campaignMediaUrl && (
              <p className="text-[10px] text-wa-green mt-1 truncate max-w-[240px]">
                📷 Image attached ({campaignMedia?.name || "URL set"})
              </p>
            )}
          </div>

          {/* Schedule for Later Option */}
          <div className="mb-4 p-3 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer">
                <Calendar size={14} className="text-wa-green" />
                Schedule for later
              </label>
              <input
                type="checkbox"
                checked={isScheduled}
                onChange={(e) => setIsScheduled(e.target.checked)}
                className="rounded text-wa-green focus:ring-wa-green cursor-pointer"
              />
            </div>

            {isScheduled && (
              <div className="pt-1 space-y-1">
                <label className="block text-[10px] text-slate-500 font-medium">Select Date & Time</label>
                <input
                  type="datetime-local"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl py-1.5 px-3 text-xs focus:outline-none focus:border-wa-green text-slate-700 font-mono"
                />
                <p className="text-[9px] text-slate-400">
                  Messages will sit safely in queue and start sending automatically at the specified time.
                </p>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 mb-4">
              <AlertCircle size={14} className="text-red-400 shrink-0" />
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          {/* Progress */}
          {sending && progress && (
            <div className="mb-4 p-3 rounded-lg bg-surface-hover border border-surface-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-400">Sending...</span>
                <span className="text-xs text-wa-green">{progress.progress}%</span>
              </div>
              <div className="h-1.5 bg-surface-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-wa-green rounded-full transition-all duration-300"
                  style={{ width: `${progress.progress}%` }}
                />
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Last: {progress.phone} — {progress.status}
              </p>
            </div>
          )}

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={sending || selectedPhones.length === 0}
            className="btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? (
              <><Loader2 size={14} className="animate-spin" /> {isScheduled ? "Scheduling..." : "Sending..."}</>
            ) : isScheduled ? (
              <><Clock size={14} /> Schedule for {selectedPhones.length} contacts</>
            ) : (
              <><Send size={14} /> Send to {selectedPhones.length} contacts</>
            )}
          </button>
        </div>

        {/* Note */}
        <div className="mt-auto p-3 rounded-lg bg-[#F3FAF4] border border-surface-border">
          <p className="text-xs text-slate-500 leading-relaxed">
            <strong className="text-slate-700">Universal CSV Support:</strong><br />
            Supports all delimiters (comma, semicolon, tab), Excel exports (scientific notation), separate First/Last Name columns, and headerless CSVs.
          </p>
        </div>
      </div>
    </div>
  );
}
