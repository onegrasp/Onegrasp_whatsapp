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
  Maximize2,
  Smartphone,
  Monitor,
  ZoomIn,
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

const renderFormattedWhatsAppBody = (bodyText, sampleMap) => {
  if (!bodyText) return <span className="text-slate-400 italic">Start drafting your template message...</span>;

  let processed = bodyText.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
    const cleanVar = varName.trim();
    if (sampleMap && sampleMap[cleanVar] && sampleMap[cleanVar] !== `[${cleanVar}]`) {
      return sampleMap[cleanVar];
    }
    if (cleanVar === "name" || cleanVar === "contact_name") return "John Doe";
    if (cleanVar === "phone" || cleanVar === "contact_phone") return "+919876543210";
    if (cleanVar === "1") return "John";
    if (cleanVar === "2") return "20%";
    if (cleanVar === "3") return "SPECIAL20";
    if (cleanVar === "date") return "2026-07-27";
    if (cleanVar === "time") return "10:30 AM";
    if (cleanVar === "venue") return "Grand Auditorium";
    if (cleanVar === "company") return "OneGrasp";
    if (cleanVar === "code") return "PROMO2026";
    if (cleanVar === "url") return "https://onegrasp.com";
    return `[${cleanVar}]`;
  });

  const lines = processed.split("\n");
  return lines.map((line, lineIdx) => {
    const words = line.split(" ");
    const lineElements = words.map((word, wordIdx) => {
      if (word.startsWith("http://") || word.startsWith("https://") || word.startsWith("www.")) {
        return (
          <span key={wordIdx} className="text-[#027eb5] font-medium underline cursor-pointer hover:opacity-80">
            {word}{" "}
          </span>
        );
      }
      return word + " ";
    });

    return (
      <span key={lineIdx}>
        {lineElements}
        {lineIdx < lines.length - 1 && <br />}
      </span>
    );
  });
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
  const [imageMeta, setImageMeta] = useState({ ratio: null, width: 0, height: 0, label: "" });

  const [showPlaceholderModal, setShowPlaceholderModal] = useState(false);
  const [placeholderSearch, setPlaceholderSearch] = useState("");

  const [showFullPreviewModal, setShowFullPreviewModal] = useState(false);
  const [previewDeviceMode, setPreviewDeviceMode] = useState("mobile");
  const [previewZoomImage, setPreviewZoomImage] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    fetchTemplatesList();
  }, []);

  // Automatic Image Aspect Ratio Detector
  useEffect(() => {
    if (!headerImageUrl) {
      setImageMeta({ ratio: null, width: 0, height: 0, label: "" });
      return;
    }
    const img = new window.Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (w && h) {
        const ratio = w / h;
        let label = `${w}x${h} px`;
        if (Math.abs(ratio - 1) < 0.05) label += " • 1:1 Square";
        else if (Math.abs(ratio - (16 / 9)) < 0.08) label += " • 16:9 Landscape";
        else if (Math.abs(ratio - (4 / 5)) < 0.08) label += " • 4:5 Portrait";
        else if (Math.abs(ratio - (9 / 16)) < 0.08) label += " • 9:16 Vertical";
        else if (ratio > 1) label += ` • ${ratio.toFixed(2)}:1 Wide`;
        else label += ` • 1:${(1 / ratio).toFixed(2)} Tall`;

        setImageMeta({ ratio, width: w, height: h, label });
      }
    };
    img.onerror = () => {
      setImageMeta({ ratio: null, width: 0, height: 0, label: "" });
    };
    img.src = headerImageUrl;
  }, [headerImageUrl]);

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
                    {imageMeta.label && (
                      <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/60 rounded-xl px-2.5 py-1 mt-1.5 animate-fade-in">
                        <Sparkles size={11} className="text-emerald-600 shrink-0 animate-pulse" />
                        <span>📐 Auto-Adjusted Aspect Ratio: {imageMeta.label}</span>
                      </div>
                    )}
                    <p className="text-[9px] text-slate-400">
                      Provide a public URL or upload an image file (e.g. PNG, JPG). The template automatically fits to the exact ratio of your image.
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
                <div className="flex items-center justify-between mb-3 shrink-0">
                  <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider select-none">
                    Live Preview Panel
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowFullPreviewModal(true)}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold px-2.5 py-1 rounded-xl flex items-center gap-1.5 shadow-sm transition-all active:scale-[0.98]"
                    title="Open full screen 100% real WhatsApp chat preview"
                  >
                    <Maximize2 size={11} />
                    Full Screen Chat
                  </button>
                </div>

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

                {/* Mock WhatsApp Screen - HYPER-REALISTIC PHONE FRAME */}
                <div className="flex-1 rounded-3xl bg-[#efeae2] border border-slate-300 shadow-xl relative overflow-hidden min-h-0 flex flex-col font-sans">
                  {/* WhatsApp Business Header */}
                  <div className="bg-[#008069] text-white px-3.5 py-2.5 flex items-center justify-between shrink-0 shadow-sm">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-xs font-extrabold text-white border border-white/30 shadow-xs">
                        OG
                      </div>
                      <div>
                        <div className="text-[12px] font-bold flex items-center gap-1 leading-tight">
                          <span>OneGrasp</span>
                          <span className="text-[9px] bg-emerald-400/30 text-emerald-100 rounded-full px-1 py-0.2 font-bold border border-emerald-300/40">✓</span>
                        </div>
                        <div className="text-[9.5px] text-emerald-100/90 font-medium">Official Business Account</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowFullPreviewModal(true)}
                      className="p-1 hover:bg-white/10 rounded-lg text-emerald-100 transition-colors"
                      title="Expand to Full Screen View"
                    >
                      <Maximize2 size={13} />
                    </button>
                  </div>

                  {/* Messages Area */}
                  <div className="flex-1 overflow-y-auto p-3 flex flex-col justify-end gap-2 bg-[#efeae2] bg-repeat" style={{ backgroundImage: "radial-gradient(#cbd5e1 0.75px, transparent 0.75px)", backgroundSize: "16px 16px" }}>
                    
                    {/* Unified WhatsApp Business Message Card Bubble */}
                    <div className="bg-white rounded-2xl rounded-tr-xs shadow-md border border-slate-200/70 max-w-[96%] w-full self-end overflow-hidden flex flex-col transition-all duration-200">
                      
                      {/* 1. Header Media Image (if media template) */}
                      {templateType === "media" && (
                        <div className="w-full bg-slate-100 overflow-hidden relative border-b border-slate-100/80 group">
                          {headerImageUrl ? (
                            <div
                              className="w-full bg-slate-900/5 flex items-center justify-center overflow-hidden relative cursor-pointer"
                              onClick={() => setShowFullPreviewModal(true)}
                              style={{
                                aspectRatio: imageMeta.ratio ? `${imageMeta.ratio}` : "auto",
                              }}
                            >
                              <img
                                src={headerImageUrl}
                                alt="Header Preview"
                                className="w-full h-full object-contain"
                              />
                              <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[11px] font-semibold gap-1 backdrop-blur-[1px]">
                                <Maximize2 size={13} /> Click for Full View
                              </div>
                            </div>
                          ) : (
                            <div className="bg-slate-100 h-36 flex flex-col items-center justify-center gap-1 text-slate-400">
                              <Image size={32} className="text-slate-300" />
                              <span className="text-[10px] font-medium text-slate-400">Header Media Image</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* 2. Message Text Body */}
                      <div className="p-3 space-y-2">
                        <div className="text-[12.5px] leading-[1.45] text-slate-800 font-normal whitespace-pre-wrap break-words">
                          {renderFormattedWhatsAppBody(body, sampleValues)}
                        </div>

                        {/* Timestamp & WhatsApp Double Checkmarks */}
                        <div className="flex items-center justify-end gap-1 text-[9.5px] text-slate-400 select-none pt-0.5">
                          <span>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                          <span className="text-[#53bdeb] font-bold text-[11px] leading-none">✓✓</span>
                        </div>
                      </div>

                      {/* 3. Action Buttons (Attached directly to bubble bottom) */}
                      {buttons && buttons.length > 0 && (
                        <div className="border-t border-slate-150 bg-white divide-y divide-slate-150">
                          {buttons.map((btn, index) => (
                            <div
                              key={index}
                              className="py-2.5 px-3 text-center text-[12px] font-semibold text-[#00a884] hover:bg-slate-50 transition-colors cursor-pointer select-none flex items-center justify-center gap-1.5 active:bg-slate-100"
                            >
                              {btn.type === "URL" ? (
                                <ExternalLink size={12} className="text-[#00a884] shrink-0" />
                              ) : btn.type === "phone" ? (
                                <Phone size={12} className="text-[#00a884] shrink-0" />
                              ) : (
                                <Sparkles size={12} className="text-[#00a884] shrink-0" />
                              )}
                              <span>{btn.text}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Mock Chat Input Footer */}
                  <div className="bg-[#f0f2f5] px-3 py-2 border-t border-slate-200 flex items-center gap-2 shrink-0">
                    <div className="bg-white rounded-full flex-1 px-3 py-1.5 text-[11px] text-slate-400 border border-slate-200">
                      Message...
                    </div>
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

      {/* 100% Real Full Screen WhatsApp Preview Modal */}
      {showFullPreviewModal && (
        <div className="fixed inset-0 z-[70] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-in fade-in zoom-in duration-200">
          <div className="bg-slate-900 text-white rounded-3xl w-full max-w-4xl max-h-[94vh] flex flex-col shadow-2xl border border-slate-800 overflow-hidden">
            {/* Modal Top Bar */}
            <div className="px-6 py-3.5 border-b border-slate-800 flex items-center justify-between gap-4 bg-slate-900/90 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold">
                  <Smartphone size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    Real WhatsApp Chat Preview
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-mono px-2 py-0.5 rounded-full border border-emerald-500/30">
                      100% High-Res
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">See exactly how your customer receives this message image & text</p>
                </div>
              </div>

              {/* View mode switcher */}
              <div className="flex items-center gap-3">
                <div className="bg-slate-800 p-1 rounded-xl flex items-center gap-1 border border-slate-700">
                  <button
                    onClick={() => setPreviewDeviceMode("mobile")}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                      previewDeviceMode === "mobile"
                        ? "bg-wa-green text-white shadow-sm"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <Smartphone size={13} />
                    Mobile
                  </button>
                  <button
                    onClick={() => setPreviewDeviceMode("desktop")}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                      previewDeviceMode === "desktop"
                        ? "bg-wa-green text-white shadow-sm"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <Monitor size={13} />
                    WhatsApp Web
                  </button>
                </div>

                {headerImageUrl && (
                  <button
                    onClick={() => setPreviewZoomImage(true)}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all"
                    title="Inspect raw full resolution image"
                  >
                    <ZoomIn size={13} className="text-emerald-400" />
                    Inspect Image
                  </button>
                )}

                <button
                  onClick={() => setShowFullPreviewModal(false)}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Modal Screen Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-[#0b141a] flex items-center justify-center min-h-0">
              {previewDeviceMode === "mobile" ? (
                <div className="w-full max-w-[440px] rounded-3xl bg-[#efeae2] border border-slate-700 shadow-2xl overflow-hidden flex flex-col my-auto transition-all">
                  <div className="bg-[#008069] text-white px-4 py-3 flex items-center justify-between shrink-0 shadow-md">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-xs font-extrabold text-white border border-white/30 shadow-xs">
                        OG
                      </div>
                      <div>
                        <div className="text-sm font-bold flex items-center gap-1.5 leading-tight">
                          <span>OneGrasp</span>
                          <span className="text-[10px] bg-emerald-400/30 text-emerald-100 rounded-full px-1.5 py-0.2 font-bold border border-emerald-300/40">✓</span>
                        </div>
                        <div className="text-[10px] text-emerald-100/90 font-medium">Official Business Account</div>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 flex flex-col justify-end gap-3 bg-[#efeae2] bg-repeat min-h-[440px]" style={{ backgroundImage: "radial-gradient(#cbd5e1 0.8px, transparent 0.8px)", backgroundSize: "18px 18px" }}>
                    <div className="bg-white rounded-2xl rounded-tr-xs shadow-lg border border-slate-200 max-w-[96%] w-full self-end overflow-hidden flex flex-col">
                      {templateType === "media" && (
                        <div className="w-full bg-slate-900/5 border-b border-slate-100 relative group">
                          {headerImageUrl ? (
                            <div
                              className="w-full flex items-center justify-center overflow-hidden relative cursor-pointer"
                              onClick={() => setPreviewZoomImage(true)}
                              style={{
                                aspectRatio: imageMeta.ratio ? `${imageMeta.ratio}` : "auto",
                              }}
                            >
                              <img
                                src={headerImageUrl}
                                alt="Full Resolution Header"
                                className="w-full h-full object-contain"
                              />
                              <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-semibold gap-1.5 backdrop-blur-[1px]">
                                <ZoomIn size={16} /> Click to Inspect Full Image
                              </div>
                            </div>
                          ) : (
                            <div className="bg-slate-100 h-44 flex flex-col items-center justify-center gap-1 text-slate-400">
                              <Image size={36} className="text-slate-300" />
                              <span className="text-xs font-medium text-slate-400">Header Media Image</span>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="p-4 space-y-2.5">
                        <div className="text-[13.5px] leading-relaxed text-slate-800 font-normal whitespace-pre-wrap break-words">
                          {renderFormattedWhatsAppBody(body, sampleValues)}
                        </div>

                        <div className="flex items-center justify-end gap-1 text-[10px] text-slate-400 select-none pt-1">
                          <span>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                          <span className="text-[#53bdeb] font-bold text-[12px] leading-none">✓✓</span>
                        </div>
                      </div>

                      {buttons && buttons.length > 0 && (
                        <div className="border-t border-slate-150 bg-white divide-y divide-slate-150">
                          {buttons.map((btn, index) => (
                            <div
                              key={index}
                              className="py-3 px-4 text-center text-xs font-semibold text-[#00a884] hover:bg-slate-50 transition-colors cursor-pointer select-none flex items-center justify-center gap-2 active:bg-slate-100"
                            >
                              {btn.type === "URL" ? (
                                <ExternalLink size={14} className="text-[#00a884] shrink-0" />
                              ) : btn.type === "phone" ? (
                                <Phone size={14} className="text-[#00a884] shrink-0" />
                              ) : (
                                <Sparkles size={14} className="text-[#00a884] shrink-0" />
                              )}
                              <span>{btn.text}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-[#f0f2f5] px-4 py-3 border-t border-slate-300 flex items-center gap-3 shrink-0">
                    <div className="bg-white rounded-full flex-1 px-4 py-2 text-xs text-slate-400 border border-slate-200">
                      Message...
                    </div>
                  </div>
                </div>
              ) : (
                <div className="w-full max-w-3xl rounded-2xl bg-[#efeae2] border border-slate-800 shadow-2xl overflow-hidden flex flex-col my-auto transition-all min-h-[520px]">
                  <div className="bg-[#f0f2f5] text-slate-800 px-5 py-3 flex items-center justify-between border-b border-slate-300 shrink-0">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-wa-green/20 text-wa-green font-bold flex items-center justify-center text-sm">
                        OG
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                          OneGrasp Official
                          <span className="text-xs text-wa-green font-bold">✓</span>
                        </h4>
                        <span className="text-xs text-slate-500">Official WhatsApp Business Account</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-6 flex-1 flex flex-col justify-end bg-[#efeae2] bg-repeat min-h-[440px]" style={{ backgroundImage: "radial-gradient(#cbd5e1 0.8px, transparent 0.8px)", backgroundSize: "18px 18px" }}>
                    <div className="bg-white rounded-2xl rounded-tr-xs shadow-xl border border-slate-200 max-w-[560px] w-full self-end overflow-hidden flex flex-col">
                      {templateType === "media" && (
                        <div className="w-full bg-slate-900/5 border-b border-slate-100 relative group">
                          {headerImageUrl ? (
                            <div
                              className="w-full flex items-center justify-center overflow-hidden relative cursor-pointer"
                              onClick={() => setPreviewZoomImage(true)}
                              style={{
                                aspectRatio: imageMeta.ratio ? `${imageMeta.ratio}` : "auto",
                              }}
                            >
                              <img
                                src={headerImageUrl}
                                alt="Full Resolution Header"
                                className="w-full h-full object-contain"
                              />
                            </div>
                          ) : (
                            <div className="bg-slate-100 h-48 flex flex-col items-center justify-center gap-1 text-slate-400">
                              <Image size={40} className="text-slate-300" />
                              <span className="text-xs font-medium text-slate-400">Header Media Image</span>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="p-5 space-y-3">
                        <div className="text-sm leading-relaxed text-slate-800 font-normal whitespace-pre-wrap break-words">
                          {renderFormattedWhatsAppBody(body, sampleValues)}
                        </div>

                        <div className="flex items-center justify-end gap-1 text-xs text-slate-400 select-none pt-1">
                          <span>{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                          <span className="text-[#53bdeb] font-bold text-sm leading-none">✓✓</span>
                        </div>
                      </div>

                      {buttons && buttons.length > 0 && (
                        <div className="border-t border-slate-150 bg-white divide-y divide-slate-150">
                          {buttons.map((btn, index) => (
                            <div
                              key={index}
                              className="py-3 px-4 text-center text-xs font-semibold text-[#00a884] hover:bg-slate-50 transition-colors cursor-pointer select-none flex items-center justify-center gap-2 active:bg-slate-100"
                            >
                              {btn.type === "URL" ? (
                                <ExternalLink size={14} className="text-[#00a884] shrink-0" />
                              ) : btn.type === "phone" ? (
                                <Phone size={14} className="text-[#00a884] shrink-0" />
                              ) : (
                                <Sparkles size={14} className="text-[#00a884] shrink-0" />
                              )}
                              <span>{btn.text}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Raw Image Zoom Lightbox Modal */}
      {previewZoomImage && headerImageUrl && (
        <div className="fixed inset-0 z-[80] bg-black/95 backdrop-blur-lg flex items-center justify-center p-4 animate-in fade-in duration-200">
          <button
            onClick={() => setPreviewZoomImage(false)}
            className="absolute top-5 right-5 text-white bg-white/10 hover:bg-white/20 p-2.5 rounded-full transition-colors z-10"
            title="Close Full Image View"
          >
            <X size={24} />
          </button>
          <div className="max-w-5xl max-h-[90vh] overflow-auto flex items-center justify-center">
            <img
              src={headerImageUrl}
              alt="Raw High Resolution Header"
              className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl border border-white/10"
            />
          </div>
        </div>
      )}
    </div>
  );
}
