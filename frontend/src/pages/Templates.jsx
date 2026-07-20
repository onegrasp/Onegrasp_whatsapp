import { useState, useEffect, useMemo } from "react";
import {
  Plus,
  Search,
  RefreshCw,
  Trash2,
  Send,
  X,
  FileText,
  AlertTriangle,
  CheckCircle,
  Clock,
  Sparkles,
  HelpCircle,
  ExternalLink,
  Phone,
  Image,
} from "lucide-react";
import {
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  submitTemplate,
  syncTemplateStatus,
  syncAllTemplates,
  uploadMediaFile,
} from "../services/api";

const extractVariables = (text) => {
  if (!text) return [];
  const regex = /\{\{([^}]+)\}\}/g;
  const matches = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const val = match[1].trim();
    if (!matches.includes(val)) {
      matches.push(val);
    }
  }
  return matches;
};

const SYSTEM_PLACEHOLDERS = [
  { tag: "{{name}}", label: "Recipient Name", category: "Contact Info", description: "Dynamically inserts recipient's full name from contact database or CSV file", sample: "John Doe" },
  { tag: "{{phone}}", label: "Recipient Phone", category: "Contact Info", description: "Dynamically inserts recipient's mobile phone number", sample: "+919876543210" },
  { tag: "{{contact_name}}", label: "Contact Name (Alt)", category: "Contact Info", description: "Alternative placeholder tag for recipient's name", sample: "John Doe" },
  { tag: "{{contact_phone}}", label: "Contact Phone (Alt)", category: "Contact Info", description: "Alternative placeholder tag for recipient's phone number", sample: "+919876543210" },
  { tag: "{{1}}", label: "Meta Parameter {{1}}", category: "Meta Positional", description: "Meta-compliant 1st parameter tag", sample: "Welcome" },
  { tag: "{{2}}", label: "Meta Parameter {{2}}", category: "Meta Positional", description: "Meta-compliant 2nd parameter tag", sample: "10%" },
  { tag: "{{3}}", label: "Meta Parameter {{3}}", category: "Meta Positional", description: "Meta-compliant 3rd parameter tag", sample: "OFFER2026" },
  { tag: "{{date}}", label: "Event / Appointment Date", category: "Event & Campaign", description: "Dynamic or custom event/webinar date", sample: "2026-07-25" },
  { tag: "{{time}}", label: "Event / Appointment Time", category: "Event & Campaign", description: "Dynamic or custom event/webinar time", sample: "10:30 AM" },
  { tag: "{{venue}}", label: "Location / Venue", category: "Event & Campaign", description: "Event venue or location details", sample: "Main Auditorium" },
  { tag: "{{company}}", label: "Company / Business Name", category: "Business Info", description: "Your registered company or brand name", sample: "OneGrasp" },
  { tag: "{{code}}", label: "Promo / Discount Code", category: "Promotional", description: "Custom promo or voucher code", sample: "SAVE50" },
  { tag: "{{url}}", label: "Website Link", category: "Links", description: "Custom destination URL link", sample: "https://onegrasp.com" },
];

const isDraftLike = (status) =>
  !status || status === "draft" || status === "unsubmitted";

const isPendingLike = (status) =>
  status === "pending" || status === "received";

const getStatusLabel = (status) => {
  if (!status || status === "draft" || status === "unsubmitted") return "Draft";
  if (status === "pending" || status === "received") return "Pending";
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return status;
};

const getTemplateType = (buttons, currentType) => {
  if (currentType === "media") return "media";
  if (buttons && buttons.length > 0) return "interactive";
  return "text";
};

export default function Templates() {
  const [templates, setTemplates] = useState([]);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);

  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("UTILITY");
  const [language, setLanguage] = useState("en");
  const [templateType, setTemplateType] = useState("text");
  const [buttons, setButtons] = useState([]);
  const [variables, setVariables] = useState([]);
  const [sampleValues, setSampleValues] = useState({});
  const [headerImageUrl, setHeaderImageUrl] = useState("");
  const [uploadingMedia, setUploadingMedia] = useState(false);

  const [showPlaceholderModal, setShowPlaceholderModal] = useState(false);
  const [placeholderSearch, setPlaceholderSearch] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    fetchTemplatesList();
  }, []);

  useEffect(() => {
    const vars = extractVariables(body);
    setVariables(vars);

    setSampleValues((prev) => {
      const newSamples = {};
      vars.forEach((v) => {
        newSamples[v] = prev[v] || `[${v}]`;
      });
      return newSamples;
    });
  }, [body]);

  const insertPlaceholder = (tag) => {
    setBody((prev) => prev + (prev.endsWith(" ") || prev === "" ? "" : " ") + tag);
  };

  const allPlaceholders = useMemo(() => {
    const customDiscovered = new Set();
    templates.forEach((t) => {
      const vars = extractVariables(t.body || "");
      vars.forEach((v) => {
        const formattedTag = `{{${v}}}`;
        const isKnown = SYSTEM_PLACEHOLDERS.some((sp) => sp.tag.toLowerCase() === formattedTag.toLowerCase());
        if (!isKnown) {
          customDiscovered.add(v);
        }
      });
    });

    const extraItems = Array.from(customDiscovered).map((v) => ({
      tag: `{{${v}}}`,
      label: `Custom Auto-Discovered: {{${v}}}`,
      category: "Auto-Discovered",
      description: `Automatically registered variable placeholder {{${v}}}`,
      sample: `Sample ${v}`,
    }));

    return [...SYSTEM_PLACEHOLDERS, ...extraItems];
  }, [templates]);

  const filteredPlaceholders = useMemo(() => {
    if (!placeholderSearch.trim()) return allPlaceholders;
    const q = placeholderSearch.toLowerCase();
    return allPlaceholders.filter(
      (item) =>
        item.tag.toLowerCase().includes(q) ||
        item.label.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
    );
  }, [allPlaceholders, placeholderSearch]);

  const fetchTemplatesList = async () => {
    try {
      setLoading(true);
      const res = await getTemplates();
      setTemplates(res.data?.data || []);
    } catch (err) {
      console.error(err);
      setError("Failed to fetch templates.");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenBuilder = (template = null) => {
    if (template) {
      setEditingTemplate(template);
      setName(template.name || "");
      setBody(template.body || "");
      setCategory(template.category || "UTILITY");
      setLanguage(template.language || "en");
      setTemplateType(template.type || "text");
      setButtons(template.buttons || []);
      setHeaderImageUrl(template.header_image_url || template.headerImageUrl || "");

      const vars = extractVariables(template.body || "");
      setVariables(vars);
      const samples = {};
      vars.forEach((v) => {
        samples[v] = `[${v}]`;
      });
      setSampleValues(samples);
    } else {
      setEditingTemplate(null);
      setName("");
      setBody("");
      setCategory("UTILITY");
      setLanguage("en");
      setTemplateType("text");
      setButtons([]);
      setVariables([]);
      setSampleValues({});
      setHeaderImageUrl("");
    }
    setError("");
    setSuccess("");
    setIsPanelOpen(true);
  };

  const handleCloseBuilder = () => {
    setIsPanelOpen(false);
    setEditingTemplate(null);
  };

  const handleAddButton = (type) => {
    if (buttons.length >= 3) return;

    const newButton = {
      type: type,
      text:
        type === "URL"
          ? "Visit Website"
          : type === "phone"
          ? "Call Us"
          : "Reply Option",
      url: type === "URL" ? "https://onegrasp.com" : "",
      phone: type === "phone" ? "+918977760442" : "",
    };
    setButtons([...buttons, newButton]);
  };

  const handleRemoveButton = (index) => {
    setButtons(buttons.filter((_, i) => i !== index));
  };

  const handleButtonTextChange = (index, value) => {
    const updated = [...buttons];
    updated[index] = { ...updated[index], text: value };
    setButtons(updated);
  };

  const handleButtonUrlChange = (index, value) => {
    const updated = [...buttons];
    updated[index] = { ...updated[index], url: value };
    setButtons(updated);
  };

  const handleButtonPhoneChange = (index, value) => {
    const updated = [...buttons];
    updated[index] = { ...updated[index], phone: value };
    setButtons(updated);
  };

  const handleSampleValueChange = (variable, value) => {
    setSampleValues((prev) => ({
      ...prev,
      [variable]: value,
    }));
  };

  const handleSubmitTemplateForm = async (e) => {
    e.preventDefault();
    if (!name || !body) {
      setError("Please fill in the template name and body message.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const computedType = getTemplateType(buttons, templateType);
      const payload = {
        name: name.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
        body,
        type: computedType,
        buttons,
        variables,
        category,
        language,
        headerImageUrl,
      };

      if (editingTemplate) {
        const templateId = editingTemplate.id || editingTemplate._id;
        await updateTemplate(templateId, payload);
        setSuccess("Template updated successfully!");
      } else {
        await createTemplate(payload);
        setSuccess("Template draft created successfully!");
      }

      fetchTemplatesList();
      setTimeout(handleCloseBuilder, 1500);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || "Failed to save template.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTemplateClick = async (id) => {
    if (!window.confirm("Are you sure you want to delete this template?"))
      return;
    try {
      setLoading(true);
      await deleteTemplate(id);
      fetchTemplatesList();
    } catch (err) {
      console.error(err);
      alert("Failed to delete template");
    } finally {
      setLoading(false);
    }
  };

  const handleSyncStatusClick = async (id) => {
    try {
      setLoading(true);
      const res = await syncTemplateStatus(id);
      setSuccess(
        `Synced approval status successfully: ${res.data?.status || "updated"}`
      );
      fetchTemplatesList();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || "Failed to sync status");
    } finally {
      setLoading(false);
    }
  };

  const handleSyncAllFromTwilio = async () => {
    try {
      setLoading(true);
      setError("");
      setSuccess("");
      const res = await syncAllTemplates();
      setSuccess(
        `Sync complete! Imported ${res.data?.created || 0} new and updated ${
          res.data?.updated || 0
        } templates.`
      );
      fetchTemplatesList();
      setTimeout(() => setSuccess(""), 4000);
    } catch (err) {
      console.error(err);
      setError(
        err.response?.data?.error ||
          "Failed to sync templates from Twilio Content API"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitForWhatsAppReview = async (id) => {
    try {
      setLoading(true);
      await submitTemplate(id);
      setSuccess("Successfully submitted to Meta for approval!");
      fetchTemplatesList();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || "Failed to submit for approval");
    } finally {
      setLoading(false);
    }
  };

  const compiledPreview = useMemo(() => {
    let preview = body;
    variables.forEach((v) => {
      const val = sampleValues[v] || `{{${v}}}`;
      preview = preview.replace(new RegExp(`\\{\\{${v}\\}\\}`, "g"), val);
    });
    return preview;
  }, [body, variables, sampleValues]);

  const filteredTemplates = useMemo(() => {
    return templates.filter((t) => {
      const matchesSearch =
        t.name?.toLowerCase().includes(search.toLowerCase()) ||
        t.body?.toLowerCase().includes(search.toLowerCase());

      const matchesCategory =
        filterCategory === "all" || t.category === filterCategory;

      let matchesStatus = false;
      if (filterStatus === "all") {
        matchesStatus = true;
      } else if (filterStatus === "draft") {
        matchesStatus = isDraftLike(t.status);
      } else if (filterStatus === "pending") {
        matchesStatus = isPendingLike(t.status);
      } else {
        matchesStatus = t.status === filterStatus;
      }

      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [templates, search, filterCategory, filterStatus]);

  const StatusBadge = ({ status }) => {
    if (status === "approved") {
      return (
        <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full px-2 py-0.5 text-[10px] font-semibold flex items-center gap-1 shrink-0">
          <CheckCircle size={10} className="text-emerald-600" />
          Approved
        </span>
      );
    }
    if (isPendingLike(status)) {
      return (
        <span className="bg-amber-50 text-amber-700 border border-amber-100 rounded-full px-2 py-0.5 text-[10px] font-semibold flex items-center gap-1 shrink-0">
          <Clock size={10} className="text-amber-600 animate-pulse" />
          Pending
        </span>
      );
    }
    if (status === "rejected") {
      return (
        <span className="bg-rose-50 text-rose-700 border border-rose-100 rounded-full px-2 py-0.5 text-[10px] font-semibold flex items-center gap-1 shrink-0">
          <AlertTriangle size={10} className="text-rose-600" />
          Rejected
        </span>
      );
    }
    return (
      <span className="bg-slate-50 text-slate-600 border border-slate-200/60 rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0">
        Draft
      </span>
    );
  };

  const TemplateCard = ({ t }) => {
    const tId = t.id || t._id;
    return (
      <div className="bg-white border border-slate-150/60 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
        <div>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3
                className="font-semibold text-slate-800 text-xs truncate max-w-[200px]"
                title={t.name}
              >
                {t.name}
              </h3>
              <span className="text-[9px] font-bold text-slate-400/80 uppercase tracking-wider">
                v{t.version || 1} • {t.category || "UTILITY"} •{" "}
                {t.language || "en"}
                {t.type === "media" && " • 🖼️ Media"}
              </span>
            </div>
            <StatusBadge status={t.status} />
          </div>

          <p className="text-[11px] text-slate-600 bg-slate-50/50 border border-slate-100/50 rounded-xl p-2.5 mt-3 line-clamp-4 leading-relaxed whitespace-pre-wrap">
            {t.body}
          </p>

          {t.buttons && t.buttons.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {t.buttons.map((btn, index) => (
                <span
                  key={index}
                  className="bg-white border border-slate-150 text-slate-600 text-[9px] font-medium px-2 py-0.5 rounded-lg flex items-center gap-1 shadow-sm"
                >
                  {btn.type === "URL" ? (
                    <ExternalLink size={8} className="text-sky-400" />
                  ) : btn.type === "phone" ? (
                    <Phone size={8} className="text-emerald-400" />
                  ) : (
                    <Sparkles size={8} className="text-slate-400" />
                  )}
                  {btn.text}
                </span>
              ))}
            </div>
          )}

          {t.status === "rejected" && (t.rejection_reason || t.rejectionReason) && (
            <div className="mt-2.5 bg-rose-50/40 border border-rose-100/40 rounded-xl p-2 text-[10px] text-rose-700 flex items-start gap-1">
              <AlertTriangle
                size={12}
                className="text-rose-500 shrink-0 mt-0.5"
              />
              <span className="break-all">{t.rejection_reason || t.rejectionReason}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-50 mt-4 pt-3">
          <div className="flex items-center gap-1.5">
            {isDraftLike(t.status) && (
              <button
                onClick={() => handleSubmitForWhatsAppReview(tId)}
                className="bg-wa-green/10 hover:bg-wa-green text-wa-green hover:text-white px-2.5 py-1 rounded-xl text-[10px] font-semibold flex items-center gap-1 transition-all"
                title="Submit to Twilio/Meta for validation review"
              >
                <Send size={10} />
                Submit Meta
              </button>
            )}
            {isPendingLike(t.status) && (
              <button
                onClick={() => handleSyncStatusClick(tId)}
                className="bg-amber-500/10 hover:bg-amber-500 text-amber-700 hover:text-white px-2.5 py-1 rounded-xl text-[10px] font-semibold flex items-center gap-1 transition-all"
                title="Sync latest status from Twilio"
              >
                <RefreshCw size={10} />
                Sync Status
              </button>
            )}
            {t.status === "approved" && (
              <span className="text-[10px] font-semibold text-emerald-600 flex items-center gap-0.5 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-100/40 select-none">
                Active SID:{" "}
                {t.contentSid || t.content_sid
                  ? `${(t.contentSid || t.content_sid).slice(0, 8)}...`
                  : ""}
              </span>
            )}
            {t.status === "rejected" && (
              <button
                onClick={() => handleOpenBuilder(t)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded-xl text-[10px] font-semibold transition-colors"
              >
                Edit & Resubmit
              </button>
            )}
          </div>

          <div className="flex items-center gap-1">
            {(isDraftLike(t.status) || t.status === "rejected") && (
              <button
                onClick={() => handleOpenBuilder(t)}
                className="text-slate-600 hover:bg-slate-100 px-2 py-1 rounded-lg text-[10px] font-semibold"
              >
                Edit
              </button>
            )}
            <button
              onClick={() => handleDeleteTemplateClick(tId)}
              className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition-colors"
              title="Delete template"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const isFormLocked = editingTemplate
    ? !isDraftLike(editingTemplate.status) && editingTemplate.status !== "rejected"
    : false;

  return (
    <div className="flex flex-col h-full bg-slate-50/50">
      {/* Header */}
      <header className="h-16 shrink-0 bg-white border-b border-slate-100 flex items-center justify-between px-6">
        <div>
          <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <FileText size={18} className="text-wa-green" />
            Template Manager
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Create, design and submit interactive WhatsApp templates for Meta
            review
          </p>
        </div>
        <button
          onClick={() => handleOpenBuilder()}
          className="bg-wa-green hover:bg-wa-green-hover text-white px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all duration-150 active:scale-[0.98]"
        >
          <Plus size={14} />
          New Template
        </button>
      </header>

      {/* Main Filter Toolbar */}
      <div className="p-6 pb-2 shrink-0 flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="relative w-full md:w-80">
          <Search
            size={14}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            placeholder="Search templates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white border border-slate-200/80 rounded-xl py-1.5 pl-9 pr-4 text-xs focus:outline-none focus:border-wa-green/60 text-slate-700 shadow-sm"
          />
        </div>

        <div className="flex items-center gap-2.5 w-full md:w-auto">
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="bg-white border border-slate-200/80 rounded-xl px-2.5 py-1.5 text-xs focus:outline-none text-slate-600 shadow-sm"
          >
            <option value="all">All Categories</option>
            <option value="MARKETING">Marketing</option>
            <option value="UTILITY">Utility</option>
            <option value="AUTHENTICATION">Authentication</option>
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-white border border-slate-200/80 rounded-xl px-2.5 py-1.5 text-xs focus:outline-none text-slate-600 shadow-sm"
          >
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="pending">Pending Approval</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>

          <button
            onClick={fetchTemplatesList}
            className="p-1.5 bg-white border border-slate-200/80 hover:bg-slate-50 text-slate-600 rounded-xl shadow-sm transition-colors"
            title="Refresh templates"
          >
            <RefreshCw
              size={14}
              className={loading ? "animate-spin" : ""}
            />
          </button>

          <button
            onClick={handleSyncAllFromTwilio}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200/80 hover:bg-slate-50 text-slate-600 rounded-xl shadow-sm text-xs font-semibold transition-all duration-150 active:scale-[0.98] shrink-0"
            title="Sync all templates from Twilio Content API"
            disabled={loading}
          >
            <RefreshCw
              size={12}
              className={loading ? "animate-spin" : ""}
            />
            Sync Twilio
          </button>
        </div>
      </div>

      {/* Success Notification Banner */}
      {success && (
        <div className="mx-6 mt-2 bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-2.5 rounded-xl text-xs flex items-center gap-2 animate-fade-in shrink-0">
          <CheckCircle size={14} className="text-emerald-600 shrink-0" />
          <span className="font-medium">{success}</span>
        </div>
      )}

      {/* Content Grid */}
      <div className="flex-1 overflow-y-auto p-6 min-h-0">
        {loading && templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-slate-400">
            <RefreshCw size={24} className="animate-spin text-wa-green/60" />
            <p className="text-xs">Loading templates...</p>
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div className="bg-white border border-slate-100 rounded-2xl p-12 text-center flex flex-col items-center justify-center">
            <FileText size={32} className="text-slate-300 mb-2" />
            <h3 className="text-sm font-semibold text-slate-700">
              No templates found
            </h3>
            <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
              Create drafts, define interactive components, and submit them
              directly for WhatsApp approval.
            </p>
            <button
              onClick={() => handleOpenBuilder()}
              className="mt-4 bg-wa-green text-white px-3 py-1.5 rounded-xl text-xs font-semibold hover:bg-wa-green-hover"
            >
              Create first template
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredTemplates.map((t) => (
              <TemplateCard key={t.id || t._id} t={t} />
            ))}
          </div>
        )}
      </div>

      {/* Slide-Over Builder Panel */}
      {isPanelOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
          {/* Backdrop overlay */}
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300"
            onClick={handleCloseBuilder}
          />

          {/* Panel Container */}
          <div className="relative w-full max-w-4xl bg-white h-full shadow-2xl flex flex-col animate-slide-in">
            {/* Panel Header */}
            <div className="h-16 border-b border-slate-100 flex items-center justify-between px-6 bg-slate-50/50 shrink-0">
              <div>
                <h2 className="text-sm font-bold text-slate-800">
                  {editingTemplate
                    ? `Edit Template (v${editingTemplate.version || 1})`
                    : "Create New Template"}
                </h2>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  Define body placeholders, buttons and watch real-time message
                  render previews.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowPlaceholderModal(true)}
                  className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200/80 text-[11px] font-bold px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition-all shadow-sm active:scale-[0.98]"
                  title="View all dynamic placeholders and variable tags"
                >
                  <Sparkles size={13} className="text-emerald-600 shrink-0" />
                  <span>Placeholders Guide</span>
                </button>

                <button
                  onClick={handleCloseBuilder}
                  className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  title="Close template builder"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Panel Body (Dual Column Layout: Left Form, Right Preview) */}
            <div className="flex-1 overflow-hidden flex flex-col md:flex-row min-h-0">
              {/* Left Column: Form Controls */}
              <form
                onSubmit={handleSubmitTemplateForm}
                className="flex-1 overflow-y-auto p-6 space-y-4 border-r border-slate-100"
              >
                {error && (
                  <div className="bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2 rounded-xl text-xs flex items-center gap-2">
                    <AlertTriangle size={12} className="text-rose-600" />
                    <span>{error}</span>
                  </div>
                )}

                {isFormLocked && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded-xl text-xs flex items-center gap-2">
                    <Clock size={12} className="text-amber-600" />
                    <span>
                      This template is {getStatusLabel(editingTemplate?.status)}.
                      Fields are read-only until the review cycle completes.
                    </span>
                  </div>
                )}

                {/* Template Name */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Template Name
                  </label>
                  <input
                    type="text"
                    required
                    disabled={isFormLocked}
                    placeholder="conference_invitation (only lowercase and underscores)"
                    value={name}
                    onChange={(e) =>
                      setName(
                        e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_")
                      )
                    }
                    className="w-full bg-white border border-slate-200 rounded-xl py-1.5 px-3 text-xs focus:outline-none focus:border-wa-green/60 text-slate-700 disabled:opacity-50 disabled:bg-slate-50"
                  />
                </div>

                {/* Category, Language & Type Row */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Category
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      disabled={isFormLocked}
                      className="w-full bg-white border border-slate-200 rounded-xl py-1.5 px-2.5 text-xs focus:outline-none text-slate-600 disabled:opacity-50 disabled:bg-slate-50"
                    >
                      <option value="UTILITY">Utility</option>
                      <option value="MARKETING">Marketing</option>
                      <option value="AUTHENTICATION">Authentication</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Language
                    </label>
                    <input
                      type="text"
                      required
                      disabled={isFormLocked}
                      placeholder="en"
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl py-1.5 px-3 text-xs focus:outline-none focus:border-wa-green/60 text-slate-700 text-center disabled:opacity-50 disabled:bg-slate-50"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Type
                    </label>
                    <select
                      value={templateType}
                      onChange={(e) => setTemplateType(e.target.value)}
                      disabled={isFormLocked}
                      className="w-full bg-white border border-slate-200 rounded-xl py-1.5 px-2.5 text-xs focus:outline-none text-slate-600 disabled:opacity-50 disabled:bg-slate-50"
                    >
                      <option value="text">Text</option>
                      <option value="media">Media (Image/Doc)</option>
                      <option value="interactive">Interactive</option>
                    </select>
                  </div>
                </div>

                {/* Header Image Option (for Media templates) */}
                {templateType === "media" && (
                  <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-3.5 space-y-2">
                    <label className="block text-[11px] font-semibold text-slate-700">
                      Header Media Image
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        disabled={isFormLocked}
                        placeholder="https://example.com/welcome-image.jpg"
                        value={headerImageUrl}
                        onChange={(e) => setHeaderImageUrl(e.target.value)}
                        className="flex-1 bg-white border border-slate-200 rounded-xl py-1.5 px-3 text-xs focus:outline-none focus:border-wa-green/60 text-slate-700 disabled:opacity-50"
                      />
                      {!isFormLocked && (
                        <label className="bg-wa-green hover:bg-wa-green-hover text-white px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer shrink-0 flex items-center justify-center min-w-[80px]">
                          {uploadingMedia ? "Uploading..." : "Upload File"}
                          <input
                            type="file"
                            accept="image/*"
                            onChange={async (e) => {
                              const file = e.target.files[0];
                              if (!file) return;
                              setUploadingMedia(true);
                              const fd = new FormData();
                              fd.append("file", file);
                              try {
                                const res = await uploadMediaFile(fd);
                                setHeaderImageUrl(res.data.mediaUrl);
                              } catch (err) {
                                alert("Media upload failed: " + (err.response?.data?.error || err.message));
                              } finally {
                                setUploadingMedia(false);
                              }
                            }}
                            className="hidden"
                          />
                        </label>
                      )}
                    </div>
                    <p className="text-[9px] text-slate-400">
                      Provide a public URL or upload an image file (e.g. PNG, JPG).
                    </p>
                  </div>
                )}

                {/* Message Body */}
                <div>
                  <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                    <label className="block text-[11px] font-semibold text-slate-600">
                      Message Body
                    </label>
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[10px] text-slate-400 mr-0.5 font-medium">Quick Insert:</span>
                      {["{{name}}", "{{phone}}", "{{date}}", "{{venue}}", "{{1}}", "{{2}}"].map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          disabled={isFormLocked}
                          onClick={() => insertPlaceholder(tag)}
                          className="text-[10px] font-mono font-bold bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 text-slate-700 border border-slate-200/80 rounded-md px-1.5 py-0.5 transition-colors disabled:opacity-40"
                        >
                          + {tag}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setShowPlaceholderModal(true)}
                        className="text-[10px] text-emerald-700 hover:underline font-bold ml-1 flex items-center gap-0.5"
                      >
                        <HelpCircle size={10} />
                        View All
                      </button>
                    </div>
                  </div>
                  <textarea
                    rows={6}
                    required
                    disabled={isFormLocked}
                    placeholder="Hello {{name}}, you are invited to the AI Research Summit on {{date}} at {{venue}}."
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-wa-green/60 text-slate-700 resize-none leading-relaxed disabled:opacity-50 disabled:bg-slate-50 font-medium"
                  />
                  <div className="text-[10px] text-slate-400 mt-0.5 text-right font-medium">
                    {body.length} characters
                  </div>
                </div>

                {/* Interactive Buttons Builder */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-semibold text-slate-600">
                      Interactive Buttons ({buttons.length}/3)
                    </label>
                    {!isFormLocked && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleAddButton("URL")}
                          disabled={buttons.length >= 3}
                          className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-0.5 rounded-lg disabled:opacity-50 font-semibold"
                        >
                          + URL Link
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAddButton("phone")}
                          disabled={buttons.length >= 3}
                          className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-0.5 rounded-lg disabled:opacity-50 font-semibold"
                        >
                          + Phone Dial
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAddButton("reply")}
                          disabled={buttons.length >= 3}
                          className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-0.5 rounded-lg disabled:opacity-50 font-semibold"
                        >
                          + Quick Reply
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2 mt-2">
                    {buttons.map((btn, index) => (
                      <div
                        key={index}
                        className="border border-slate-100 rounded-xl p-3 bg-slate-50/50 flex flex-col gap-2 relative"
                      >
                        {!isFormLocked && (
                          <button
                            type="button"
                            onClick={() => handleRemoveButton(index)}
                            className="absolute right-2 top-2 text-slate-400 hover:text-rose-500 p-0.5 hover:bg-white rounded-lg transition-colors"
                          >
                            <X size={12} />
                          </button>
                        )}

                        <div className="grid grid-cols-3 gap-2">
                          <div className="col-span-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider select-none">
                              Type: {btn.type}
                            </span>
                          </div>
                          <div className="col-span-2">
                            <input
                              type="text"
                              required
                              disabled={isFormLocked}
                              placeholder="Button text label"
                              value={btn.text}
                              onChange={(e) =>
                                handleButtonTextChange(index, e.target.value)
                              }
                              className="w-full bg-white border border-slate-200 rounded-lg py-0.5 px-2 text-[11px] focus:outline-none disabled:opacity-50 disabled:bg-slate-50"
                            />
                          </div>
                        </div>

                        {btn.type === "URL" && (
                          <input
                            type="url"
                            required
                            disabled={isFormLocked}
                            placeholder="https://example.com/register"
                            value={btn.url}
                            onChange={(e) =>
                              handleButtonUrlChange(index, e.target.value)
                            }
                            className="w-full bg-white border border-slate-200 rounded-lg py-0.5 px-2 text-[10px] focus:outline-none disabled:opacity-50 disabled:bg-slate-50"
                          />
                        )}

                        {btn.type === "phone" && (
                          <input
                            type="text"
                            required
                            disabled={isFormLocked}
                            placeholder="+918977760442"
                            value={btn.phone}
                            onChange={(e) =>
                              handleButtonPhoneChange(index, e.target.value)
                            }
                            className="w-full bg-white border border-slate-200 rounded-lg py-0.5 px-2 text-[10px] focus:outline-none disabled:opacity-50 disabled:bg-slate-50"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Submits form */}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={loading || isFormLocked}
                    className="w-full bg-wa-green hover:bg-wa-green-hover text-white py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1 transition-colors disabled:opacity-50"
                  >
                    {loading
                      ? "Saving Template..."
                      : editingTemplate
                      ? "Update Template Draft"
                      : "Save Template Draft"}
                  </button>
                </div>
              </form>

              {/* Right Column: Live WhatsApp Preview */}
              <div className="w-full md:w-[380px] bg-slate-50 p-4 flex flex-col min-h-0 shrink-0">
                <h3 className="text-[11px] font-semibold text-slate-500 mb-3 uppercase tracking-wider select-none shrink-0">
                  Live Preview Panel
                </h3>

                {/* Variables Preview Editor */}
                {variables.length > 0 && (
                  <div className="bg-white border border-slate-100 rounded-2xl p-3 mb-3 shadow-sm shrink-0">
                    <span className="text-[10px] font-semibold text-slate-700 block mb-2">
                      Test Placeholder Values
                    </span>
                    <div className="space-y-2 max-h-28 overflow-y-auto">
                      {variables.map((v) => (
                        <div
                          key={v}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="text-[10px] font-mono text-slate-500 shrink-0">
                            {"{{"}
                            {v}
                            {"}}"}
                          </span>
                          <input
                            type="text"
                            value={sampleValues[v] || ""}
                            onChange={(e) =>
                              handleSampleValueChange(v, e.target.value)
                            }
                            className="bg-slate-50 border border-slate-100 rounded-lg px-2 py-0.5 text-[10px] focus:outline-none w-32"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Mock WhatsApp Screen - SCROLLABLE */}
                <div className="flex-1 rounded-2xl bg-[#efeae2] border border-slate-200 shadow-inner relative overflow-hidden min-h-0 flex flex-col">
                  {/* WhatsApp-style header */}
                  <div className="bg-[#075e54] text-white px-4 py-2 flex items-center gap-2 shrink-0">
                    <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-bold">
                      OG
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold">OneGrasp</div>
                      <div className="text-[9px] opacity-70">online</div>
                    </div>
                  </div>

                  {/* Messages area - SCROLLABLE */}
                  <div className="flex-1 overflow-y-auto p-3 flex flex-col justify-end gap-2">
                    {/* Media header preview */}
                    {templateType === "media" && (
                      <div className="bg-white rounded-2xl rounded-tr-none max-w-[92%] shadow-sm border border-slate-100/50 self-end overflow-hidden w-full">
                        {headerImageUrl ? (
                          <img
                            src={headerImageUrl}
                            alt="Header Preview"
                            className="w-full h-auto max-h-[380px] object-contain bg-slate-900/5 rounded-t-2xl"
                          />
                        ) : (
                          <div className="bg-slate-100 h-32 flex items-center justify-center">
                            <Image
                              size={28}
                              className="text-slate-300"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Mock WhatsApp Message Bubble */}
                    <div className="bg-white rounded-2xl rounded-tr-none px-3.5 py-2.5 max-w-[92%] shadow-sm text-xs border border-slate-100/50 leading-relaxed text-slate-800 relative self-end">
                      <p className="whitespace-pre-wrap font-medium break-words">
                        {compiledPreview || "Start drafting your template..."}
                      </p>
                      <span className="text-[9px] text-slate-400 block text-right mt-1.5 select-none leading-none">
                        {new Date().toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        ✓✓
                      </span>
                    </div>

                    {/* Render buttons previews */}
                    {buttons.length > 0 && (
                      <div className="space-y-1 max-w-[92%] self-end w-full">
                        {buttons.map((btn, index) => (
                          <div
                            key={index}
                            className="bg-white border border-slate-100 rounded-xl py-2 px-3 text-center text-xs font-semibold text-sky-600 shadow-sm cursor-pointer hover:bg-slate-50/50 select-none flex items-center justify-center gap-1.5"
                          >
                            {btn.type === "URL" ? (
                              <ExternalLink
                                size={11}
                                className="text-sky-400"
                              />
                            ) : btn.type === "phone" ? (
                              <Phone size={11} className="text-sky-400" />
                            ) : (
                              <Sparkles size={11} className="text-sky-400" />
                            )}
                            {btn.text}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Placeholders & Variables Guide Modal */}
      {showPlaceholderModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-2xl shadow-2xl space-y-4 animate-scale-up border border-slate-100 flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 font-bold shadow-sm">
                  <Sparkles size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-800">Placeholders & Variable Guide</h3>
                  <p className="text-xs text-slate-500">All dynamic variable tags available for personal custom messaging</p>
                </div>
              </div>
              <button
                onClick={() => setShowPlaceholderModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search placeholders (e.g. {{name}}, {{date}}, {{1}}, {{venue}})..."
                value={placeholderSearch}
                onChange={(e) => setPlaceholderSearch(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-9 pr-3 text-xs focus:outline-none focus:border-wa-green text-slate-700"
              />
            </div>

            {/* List of Placeholders */}
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {filteredPlaceholders.map((item, idx) => (
                <div key={idx} className="bg-slate-50/70 border border-slate-200/60 rounded-2xl p-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-xs bg-emerald-500/10 text-emerald-800 border border-emerald-500/20 px-2 py-0.5 rounded-lg select-all">
                        {item.tag}
                      </span>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded-md">
                        {item.category}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-slate-800">{item.label}</p>
                    <p className="text-[11px] text-slate-500 leading-normal">{item.description}</p>
                    {item.sample && (
                      <p className="text-[10px] text-slate-400 font-mono">
                        Sample value: <span className="text-emerald-700 font-bold">"{item.sample}"</span>
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      insertPlaceholder(item.tag);
                      setShowPlaceholderModal(false);
                    }}
                    className="bg-wa-green hover:bg-wa-green-hover text-white font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1 shrink-0 shadow-sm transition-all active:scale-[0.98]"
                  >
                    + Insert
                  </button>
                </div>
              ))}
            </div>

            {/* Modal Footer Note */}
            <div className="p-3 bg-emerald-50/70 border border-emerald-200/50 rounded-2xl text-[11px] text-emerald-800 flex items-center justify-between gap-2">
              <span className="font-medium">
                ✨ Any new custom column added to contacts or uploaded via CSV automatically registers here!
              </span>
              <button
                type="button"
                onClick={() => setShowPlaceholderModal(false)}
                className="text-xs font-bold text-emerald-800 hover:underline shrink-0"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
