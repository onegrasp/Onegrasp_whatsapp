import { useEffect, useMemo, useState } from "react";
import { Eye, FileText, Maximize2, Pencil, Plus, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
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
import { Dialog, EmptyState, ErrorState, Field, LoadingRows, Page, PageHeader, SegmentedControl, Sheet, StatusBadge } from "../components/ui";
import { useConfirm, useToast } from "../components/feedback";
import WhatsAppPreview from "../components/WhatsAppPreview";
import { errorMessage } from "../lib/format";

const extractVariables = (text) => {
  if (!text) return [];
  const regex = /\{\{([^}]+)\}\}/g;
  const matches = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const val = match[1].trim();
    if (!matches.includes(val)) matches.push(val);
  }
  return matches;
};

const SYSTEM_PLACEHOLDERS = [
  { tag: "{{name}}", label: "Recipient name", category: "Contact", description: "Recipient's name from your contacts or upload file", sample: "John Doe" },
  { tag: "{{phone}}", label: "Recipient phone", category: "Contact", description: "Recipient's mobile number", sample: "+919876543210" },
  { tag: "{{contact_name}}", label: "Contact name (alternative)", category: "Contact", description: "Alternative tag for the recipient's name", sample: "John Doe" },
  { tag: "{{contact_phone}}", label: "Contact phone (alternative)", category: "Contact", description: "Alternative tag for the recipient's number", sample: "+919876543210" },
  { tag: "{{1}}", label: "Parameter 1", category: "Positional", description: "First positional parameter (Meta format)", sample: "Welcome" },
  { tag: "{{2}}", label: "Parameter 2", category: "Positional", description: "Second positional parameter", sample: "10%" },
  { tag: "{{3}}", label: "Parameter 3", category: "Positional", description: "Third positional parameter", sample: "OFFER2026" },
  { tag: "{{date}}", label: "Event date", category: "Event", description: "Event or appointment date", sample: "2026-07-25" },
  { tag: "{{time}}", label: "Event time", category: "Event", description: "Event or appointment time", sample: "10:30 AM" },
  { tag: "{{venue}}", label: "Venue", category: "Event", description: "Event location", sample: "Main Auditorium" },
  { tag: "{{company}}", label: "Company name", category: "Business", description: "Your company or brand name", sample: "OneGrasp" },
  { tag: "{{code}}", label: "Promo code", category: "Promotion", description: "Promo or voucher code", sample: "SAVE50" },
  { tag: "{{url}}", label: "Website link", category: "Links", description: "Destination URL", sample: "https://onegrasp.com" },
];

const QUICK_INSERT = ["{{name}}", "{{phone}}", "{{date}}", "{{venue}}", "{{1}}", "{{2}}"];

const DEFAULT_SAMPLES = {
  name: "John Doe",
  contact_name: "John Doe",
  phone: "+919876543210",
  contact_phone: "+919876543210",
  1: "John",
  2: "20%",
  3: "SPECIAL20",
  date: "2026-07-27",
  time: "10:30 AM",
  venue: "Grand Auditorium",
  company: "OneGrasp",
  code: "PROMO2026",
  url: "https://onegrasp.com",
};

// Replaces {{variables}} with the editor's sample values (or sensible defaults)
// so the preview reads like a real message.
const fillSamples = (body, samples) =>
  (body || "").replace(/\{\{([^}]+)\}\}/g, (match, raw) => {
    const key = raw.trim();
    const custom = samples?.[key];
    if (custom && custom !== `[${key}]`) return custom;
    return DEFAULT_SAMPLES[key] || `[${key}]`;
  });

const isDraftLike = (status) => !status || status === "draft" || status === "unsubmitted";
const isPendingLike = (status) => status === "pending" || status === "received";

const getStatusLabel = (status) => {
  if (isDraftLike(status)) return "draft";
  if (isPendingLike(status)) return "pending approval";
  return status;
};

const getTemplateType = (buttons, currentType) => {
  if (currentType === "media") return "media";
  if (buttons && buttons.length > 0) return "interactive";
  return "text";
};

const TYPE_LABEL = { text: "Text", media: "Media", interactive: "Interactive" };

export default function Templates() {
  const toast = useToast();
  const confirm = useConfirm();

  const [templates, setTemplates] = useState([]);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [syncingAll, setSyncingAll] = useState(false);

  // Editor state
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
  const [imageMeta, setImageMeta] = useState({ ratio: null, label: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [showPlaceholderModal, setShowPlaceholderModal] = useState(false);
  const [placeholderSearch, setPlaceholderSearch] = useState("");
  const [showFullPreviewModal, setShowFullPreviewModal] = useState(false);
  const [previewDeviceMode, setPreviewDeviceMode] = useState("mobile");
  const [previewZoomImage, setPreviewZoomImage] = useState(false);

  useEffect(() => {
    fetchTemplatesList();
  }, []);

  // Detect the header image's aspect ratio so the preview matches it.
  useEffect(() => {
    if (!headerImageUrl) {
      setImageMeta({ ratio: null, label: "" });
      return;
    }
    const img = new window.Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) return;
      const ratio = w / h;
      let shape = ratio > 1 ? `${ratio.toFixed(2)}:1` : `1:${(1 / ratio).toFixed(2)}`;
      if (Math.abs(ratio - 1) < 0.05) shape = "1:1 square";
      else if (Math.abs(ratio - 16 / 9) < 0.08) shape = "16:9 landscape";
      else if (Math.abs(ratio - 4 / 5) < 0.08) shape = "4:5 portrait";
      else if (Math.abs(ratio - 9 / 16) < 0.08) shape = "9:16 vertical";
      setImageMeta({ ratio, label: `${w} × ${h} px · ${shape}` });
    };
    img.onerror = () => setImageMeta({ ratio: null, label: "" });
    img.src = headerImageUrl;
  }, [headerImageUrl]);

  useEffect(() => {
    const vars = extractVariables(body);
    setVariables(vars);
    setSampleValues((prev) => {
      const next = {};
      vars.forEach((v) => {
        next[v] = prev[v] || `[${v}]`;
      });
      return next;
    });
  }, [body]);

  const fetchTemplatesList = async () => {
    try {
      setLoading(true);
      setListError("");
      const res = await getTemplates();
      setTemplates(res.data?.data || []);
    } catch (err) {
      console.error(err);
      setListError("Templates could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  const insertPlaceholder = (tag) => {
    if (!tag) return;
    setBody((prev) => prev + (prev.endsWith(" ") || prev === "" ? "" : " ") + tag);
  };

  const allPlaceholders = useMemo(() => {
    const discovered = new Set();
    templates.forEach((t) => {
      extractVariables(t.body || "").forEach((v) => {
        const tag = `{{${v}}}`;
        if (!SYSTEM_PLACEHOLDERS.some((sp) => sp.tag.toLowerCase() === tag.toLowerCase())) discovered.add(v);
      });
    });
    const extra = Array.from(discovered).map((v) => ({
      tag: `{{${v}}}`,
      label: `{{${v}}}`,
      category: "Used in your templates",
      description: "Found in an existing template",
      sample: `Sample ${v}`,
    }));
    return [...SYSTEM_PLACEHOLDERS, ...extra];
  }, [templates]);

  const filteredPlaceholders = useMemo(() => {
    const q = placeholderSearch.trim().toLowerCase();
    if (!q) return allPlaceholders;
    return allPlaceholders.filter((item) =>
      [item.tag, item.label, item.description, item.category].some((s) => s.toLowerCase().includes(q))
    );
  }, [allPlaceholders, placeholderSearch]);

  const loadIntoEditor = (template) => {
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
      setSampleValues(Object.fromEntries(vars.map((v) => [v, `[${v}]`])));
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
    setFormError("");
  };

  const handleOpenBuilder = (template = null) => {
    loadIntoEditor(template);
    setIsPanelOpen(true);
  };

  const handleOpenPreview = (template) => {
    loadIntoEditor(template);
    setPreviewDeviceMode("mobile");
    setShowFullPreviewModal(true);
  };

  const handleCloseBuilder = () => {
    setIsPanelOpen(false);
    setEditingTemplate(null);
  };

  const handleAddButton = (type) => {
    if (buttons.length >= 3) return;
    setButtons([
      ...buttons,
      {
        type,
        text: type === "URL" ? "Visit website" : type === "phone" ? "Call us" : "Reply",
        url: type === "URL" ? "https://onegrasp.com" : "",
        phone: type === "phone" ? "+918977760442" : "",
      },
    ]);
  };

  const updateButton = (index, field, value) =>
    setButtons((prev) => prev.map((b, i) => (i === index ? { ...b, [field]: value } : b)));

  const handleHeaderUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingMedia(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await uploadMediaFile(fd);
      setHeaderImageUrl(res.data.mediaUrl);
    } catch (err) {
      toast.error(`Image upload failed: ${errorMessage(err)}`);
    } finally {
      setUploadingMedia(false);
    }
  };

  const handleSubmitTemplateForm = async (e) => {
    e.preventDefault();
    if (!name || !body) {
      setFormError("Add a template name and message body.");
      return;
    }
    try {
      setSaving(true);
      setFormError("");
      const payload = {
        name: name.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
        body,
        type: getTemplateType(buttons, templateType),
        buttons,
        variables,
        category,
        language,
        headerImageUrl,
      };
      if (editingTemplate) {
        await updateTemplate(editingTemplate.id || editingTemplate._id, payload);
        toast.success("Template updated");
      } else {
        await createTemplate(payload);
        toast.success("Template draft saved");
      }
      fetchTemplatesList();
      handleCloseBuilder();
    } catch (err) {
      console.error(err);
      setFormError(errorMessage(err, "The template could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (template) => {
    const ok = await confirm({
      title: "Delete template?",
      message: `"${template.name}" will be removed from this app.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      setBusyId(template.id || template._id);
      await deleteTemplate(template.id || template._id);
      toast.success("Template deleted");
      fetchTemplatesList();
    } catch (err) {
      toast.error(`Could not delete template: ${errorMessage(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleSyncStatus = async (id) => {
    try {
      setBusyId(id);
      const res = await syncTemplateStatus(id);
      toast.success(`Status updated: ${res.data?.status || "no change"}`);
      fetchTemplatesList();
    } catch (err) {
      toast.error(errorMessage(err, "Could not sync the status."));
    } finally {
      setBusyId(null);
    }
  };

  const handleSyncAll = async () => {
    try {
      setSyncingAll(true);
      const res = await syncAllTemplates();
      toast.success(`Sync complete: ${res.data?.created || 0} imported, ${res.data?.updated || 0} updated.`);
      fetchTemplatesList();
    } catch (err) {
      toast.error(errorMessage(err, "Could not sync templates from Twilio."));
    } finally {
      setSyncingAll(false);
    }
  };

  const handleSubmitForReview = async (id) => {
    try {
      setBusyId(id);
      await submitTemplate(id);
      toast.success("Submitted for WhatsApp approval");
      fetchTemplatesList();
    } catch (err) {
      toast.error(errorMessage(err, "Could not submit for approval."));
    } finally {
      setBusyId(null);
    }
  };

  const filteredTemplates = useMemo(() => {
    const q = search.toLowerCase();
    return templates.filter((t) => {
      const matchesSearch = t.name?.toLowerCase().includes(q) || t.body?.toLowerCase().includes(q);
      const matchesCategory = filterCategory === "all" || t.category === filterCategory;
      const matchesStatus =
        filterStatus === "all" ||
        (filterStatus === "draft" && isDraftLike(t.status)) ||
        (filterStatus === "pending" && isPendingLike(t.status)) ||
        t.status === filterStatus;
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [templates, search, filterCategory, filterStatus]);

  const isFormLocked = editingTemplate ? !isDraftLike(editingTemplate.status) && editingTemplate.status !== "rejected" : false;
  const previewBody = fillSamples(body, sampleValues);

  return (
    <Page
      header={
        <PageHeader
          title="Templates"
          description="Create message templates and submit them for WhatsApp approval."
          actions={
            <>
              <button type="button" className="btn btn-secondary" onClick={handleSyncAll} disabled={syncingAll}>
                <RefreshCw size={14} className={syncingAll ? "animate-spin" : ""} aria-hidden="true" />
                {syncingAll ? "Syncing…" : "Sync from Twilio"}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => handleOpenBuilder()}>
                <Plus size={14} aria-hidden="true" />
                New template
              </button>
            </>
          }
        />
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input type="search" aria-label="Search templates" placeholder="Search name or text" value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-8" />
        </div>
        <select aria-label="Filter by category" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="input w-auto">
          <option value="all">All categories</option>
          <option value="MARKETING">Marketing</option>
          <option value="UTILITY">Utility</option>
          <option value="AUTHENTICATION">Authentication</option>
        </select>
        <select aria-label="Filter by status" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="input w-auto">
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="pending">Pending approval</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <button type="button" onClick={fetchTemplatesList} className="btn btn-ghost btn-icon" aria-label="Refresh templates">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {listError && (
        <div className="mb-3">
          <ErrorState message={listError} onRetry={fetchTemplatesList} />
        </div>
      )}

      <div className="panel overflow-hidden">
        {!loading && filteredTemplates.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={templates.length === 0 ? "No templates yet" : "No matching templates"}
            description={templates.length === 0 ? "Create a template, then submit it for WhatsApp approval." : "Try a different search or filter."}
            action={
              templates.length === 0 && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => handleOpenBuilder()}>
                  New template
                </button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Template</th>
                  <th>Category</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && templates.length === 0 ? (
                  <LoadingRows rows={5} cols={5} />
                ) : (
                  filteredTemplates.map((t) => {
                    const id = t.id || t._id;
                    const sid = t.contentSid || t.content_sid;
                    const busy = busyId === id;
                    return (
                      <tr key={id} className="hover:bg-gray-50">
                        <td className="max-w-md py-2.5">
                          <p className="font-medium text-gray-900">{t.name}</p>
                          <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{t.body}</p>
                          {t.status === "rejected" && (t.rejection_reason || t.rejectionReason) && (
                            <p className="mt-1 text-xs text-red-700">Rejected: {t.rejection_reason || t.rejectionReason}</p>
                          )}
                        </td>
                        <td className="whitespace-nowrap">
                          {(t.category || "UTILITY").charAt(0) + (t.category || "UTILITY").slice(1).toLowerCase()}
                          <span className="text-gray-400"> · {t.language || "en"}</span>
                        </td>
                        <td className="whitespace-nowrap">{TYPE_LABEL[t.type] || "Text"}</td>
                        <td className="whitespace-nowrap">
                          <StatusBadge kind="template" status={t.status} />
                          {t.status === "approved" && sid && <p className="mt-1 font-mono text-2xs text-gray-500" title={sid}>{sid.slice(0, 12)}…</p>}
                        </td>
                        <td>
                          <div className="flex items-center justify-end gap-1">
                            {isDraftLike(t.status) && (
                              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => handleSubmitForReview(id)}>
                                Submit for approval
                              </button>
                            )}
                            {isPendingLike(t.status) && (
                              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => handleSyncStatus(id)}>
                                <RefreshCw size={13} className={busy ? "animate-spin" : ""} aria-hidden="true" />
                                Check status
                              </button>
                            )}
                            {t.status === "rejected" && (
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleOpenBuilder(t)}>
                                Edit and resubmit
                              </button>
                            )}
                            <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => handleOpenPreview(t)} aria-label={`Preview ${t.name}`} title="Preview">
                              <Eye size={15} />
                            </button>
                            {isDraftLike(t.status) && (
                              <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => handleOpenBuilder(t)} aria-label={`Edit ${t.name}`} title="Edit">
                                <Pencil size={14} />
                              </button>
                            )}
                            <button type="button" className="btn btn-ghost btn-sm btn-icon hover:text-red-600" disabled={busy} onClick={() => handleDelete(t)} aria-label={`Delete ${t.name}`} title="Delete">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Editor */}
      <Sheet
        open={isPanelOpen}
        onClose={handleCloseBuilder}
        title={editingTemplate ? `Edit template · v${editingTemplate.version || 1}` : "New template"}
        description="Changes are saved as a draft until you submit for approval."
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={handleCloseBuilder}>
              Cancel
            </button>
            <button type="submit" form="template-form" className="btn btn-primary" disabled={saving || isFormLocked}>
              {saving ? "Saving…" : editingTemplate ? "Update draft" : "Save draft"}
            </button>
          </>
        }
      >
        <div className="flex h-full flex-col overflow-y-auto md:flex-row md:overflow-hidden">
          <form id="template-form" onSubmit={handleSubmitTemplateForm} className="space-y-5 p-5 md:flex-1 md:overflow-y-auto">
            {isFormLocked && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-13 text-amber-900">
                This template is {getStatusLabel(editingTemplate?.status)}, so it can't be edited until review finishes.
              </p>
            )}
            {formError && <ErrorState message={formError} />}

            <Field label="Name" hint="Lowercase letters, numbers and underscores only.">
              {(id) => (
                <input
                  id={id}
                  required
                  disabled={isFormLocked}
                  className="input font-mono text-13"
                  placeholder="conference_invitation"
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
                />
              )}
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Category">
                {(id) => (
                  <select id={id} className="input" value={category} onChange={(e) => setCategory(e.target.value)} disabled={isFormLocked}>
                    <option value="UTILITY">Utility</option>
                    <option value="MARKETING">Marketing</option>
                    <option value="AUTHENTICATION">Authentication</option>
                  </select>
                )}
              </Field>
              <Field label="Language">
                {(id) => <input id={id} required className="input" placeholder="en" value={language} onChange={(e) => setLanguage(e.target.value)} disabled={isFormLocked} />}
              </Field>
              <Field label="Type">
                {(id) => (
                  <select id={id} className="input" value={templateType} onChange={(e) => setTemplateType(e.target.value)} disabled={isFormLocked}>
                    <option value="text">Text</option>
                    <option value="media">Media (image)</option>
                    <option value="interactive">Interactive</option>
                  </select>
                )}
              </Field>
            </div>

            {templateType === "media" && (
              <div>
                <label htmlFor="header-image" className="label">
                  Header image
                </label>
                <div className="flex gap-2">
                  <input
                    id="header-image"
                    type="url"
                    disabled={isFormLocked}
                    className="input"
                    placeholder="https://example.com/image.jpg"
                    value={headerImageUrl}
                    onChange={(e) => setHeaderImageUrl(e.target.value)}
                  />
                  {!isFormLocked && (
                    <label className={`btn btn-secondary cursor-pointer ${uploadingMedia ? "pointer-events-none opacity-50" : ""}`}>
                      <Upload size={14} aria-hidden="true" />
                      {uploadingMedia ? "Uploading…" : "Upload"}
                      <input type="file" accept="image/*" onChange={handleHeaderUpload} className="sr-only" />
                    </label>
                  )}
                </div>
                <p className="hint">{imageMeta.label ? `Detected ${imageMeta.label}. The preview uses the same shape.` : "Public image URL, or upload a PNG or JPG."}</p>
              </div>
            )}

            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="template-body" className="text-sm font-medium text-gray-700">
                  Message
                </label>
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Insert a variable"
                    className="input input-sm w-auto"
                    value=""
                    onChange={(e) => insertPlaceholder(e.target.value)}
                    disabled={isFormLocked}
                  >
                    <option value="">Insert variable…</option>
                    {QUICK_INSERT.map((tag) => (
                      <option key={tag} value={tag}>
                        {tag}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="text-13 font-medium text-brand-700 hover:text-brand-800" onClick={() => setShowPlaceholderModal(true)}>
                    All variables
                  </button>
                </div>
              </div>
              <textarea
                id="template-body"
                rows={7}
                required
                disabled={isFormLocked}
                className="input resize-y"
                placeholder="Hello {{name}}, you're invited to the AI Research Summit on {{date}} at {{venue}}."
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
              <p className="hint text-right tabular-nums">{body.length} characters</p>
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-gray-700">
                  Buttons <span className="font-normal text-gray-400">({buttons.length}/3)</span>
                </span>
                {!isFormLocked && (
                  <div className="flex gap-1.5">
                    <button type="button" className="btn btn-secondary btn-sm" disabled={buttons.length >= 3} onClick={() => handleAddButton("URL")}>
                      + Link
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" disabled={buttons.length >= 3} onClick={() => handleAddButton("phone")}>
                      + Call
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" disabled={buttons.length >= 3} onClick={() => handleAddButton("reply")}>
                      + Quick reply
                    </button>
                  </div>
                )}
              </div>
              {buttons.length === 0 ? (
                <p className="text-13 text-gray-500">No buttons.</p>
              ) : (
                <ul className="space-y-2">
                  {buttons.map((btn, index) => (
                    <li key={index} className="rounded-md border border-gray-200 p-3">
                      <div className="flex items-center gap-2">
                        <span className="w-20 shrink-0 text-xs font-medium text-gray-500">
                          {btn.type === "URL" ? "Link" : btn.type === "phone" ? "Call" : "Quick reply"}
                        </span>
                        <input
                          aria-label="Button label"
                          required
                          disabled={isFormLocked}
                          className="input input-sm"
                          placeholder="Button label"
                          value={btn.text}
                          onChange={(e) => updateButton(index, "text", e.target.value)}
                        />
                        {!isFormLocked && (
                          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => setButtons(buttons.filter((_, i) => i !== index))} aria-label="Remove button">
                            <X size={14} />
                          </button>
                        )}
                      </div>
                      {btn.type === "URL" && (
                        <input
                          aria-label="Button link"
                          type="url"
                          required
                          disabled={isFormLocked}
                          className="input input-sm mt-2"
                          placeholder="https://example.com/register"
                          value={btn.url}
                          onChange={(e) => updateButton(index, "url", e.target.value)}
                        />
                      )}
                      {btn.type === "phone" && (
                        <input
                          aria-label="Button phone number"
                          required
                          disabled={isFormLocked}
                          className="input input-sm mt-2"
                          placeholder="+918977760442"
                          value={btn.phone}
                          onChange={(e) => updateButton(index, "phone", e.target.value)}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {templateType === "media" && buttons.length > 0 && (
                <p className="hint text-amber-700">Image templates with buttons are sent as a card, which can drop the message text. Build these in WhatsApp Manager instead.</p>
              )}
            </div>
          </form>

          <aside className="flex shrink-0 flex-col gap-4 border-t border-gray-200 bg-gray-50 p-5 md:w-[380px] md:overflow-y-auto md:border-l md:border-t-0">
            <div className="flex items-center justify-between">
              <h3 className="section-title">Preview</h3>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowFullPreviewModal(true)}>
                <Maximize2 size={13} aria-hidden="true" />
                Full screen
              </button>
            </div>

            {variables.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-gray-500">Sample values</p>
                <div className="space-y-2">
                  {variables.map((v) => (
                    <div key={v} className="flex items-center gap-2">
                      <span className="w-28 shrink-0 truncate font-mono text-xs text-gray-600">{`{{${v}}}`}</span>
                      <input
                        aria-label={`Sample value for ${v}`}
                        className="input input-sm"
                        value={sampleValues[v] || ""}
                        onChange={(e) => setSampleValues((prev) => ({ ...prev, [v]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <WhatsAppPreview
              body={previewBody}
              headerImageUrl={templateType === "media" ? headerImageUrl : ""}
              showImageSlot={templateType === "media"}
              imageRatio={imageMeta.ratio}
              buttons={buttons}
              onImageClick={() => setShowFullPreviewModal(true)}
            />
          </aside>
        </div>
      </Sheet>

      {/* Variables guide */}
      <Dialog
        open={showPlaceholderModal}
        onClose={() => setShowPlaceholderModal(false)}
        title="Variables"
        description="Insert a variable to personalise each message."
        size="xl"
      >
        <input
          type="search"
          aria-label="Search variables"
          placeholder="Search variables"
          value={placeholderSearch}
          onChange={(e) => setPlaceholderSearch(e.target.value)}
          className="input mb-3"
        />
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
          {filteredPlaceholders.map((item) => (
            <li key={item.tag} className="flex items-center gap-4 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-2">
                  <code className="font-mono text-13 text-gray-900">{item.tag}</code>
                  <span className="text-xs text-gray-500">{item.category}</span>
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {item.description}
                  {item.sample && <> · e.g. "{item.sample}"</>}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={isFormLocked || !isPanelOpen}
                onClick={() => {
                  insertPlaceholder(item.tag);
                  setShowPlaceholderModal(false);
                }}
              >
                Insert
              </button>
            </li>
          ))}
          {filteredPlaceholders.length === 0 && <li className="px-3 py-6 text-center text-sm text-gray-500">No variables match.</li>}
        </ul>
      </Dialog>

      {/* Full preview */}
      <Dialog
        open={showFullPreviewModal}
        onClose={() => setShowFullPreviewModal(false)}
        title={name ? `Preview · ${name}` : "Preview"}
        description="Shows the version saved in this app. WhatsApp delivers the approved version."
        size="2xl"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <SegmentedControl
            label="Preview device"
            size="sm"
            value={previewDeviceMode}
            onChange={setPreviewDeviceMode}
            options={[
              { value: "mobile", label: "Phone" },
              { value: "desktop", label: "WhatsApp Web" },
            ]}
          />
          {templateType === "media" && headerImageUrl && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPreviewZoomImage(true)}>
              View image
            </button>
          )}
        </div>
        <div className={previewDeviceMode === "mobile" ? "mx-auto max-w-[420px]" : ""}>
          <WhatsAppPreview
            body={previewBody}
            headerImageUrl={templateType === "media" ? headerImageUrl : ""}
            showImageSlot={templateType === "media"}
            imageRatio={imageMeta.ratio}
            buttons={buttons}
            variant={previewDeviceMode === "mobile" ? "mobile" : "web"}
            size="lg"
            onImageClick={() => setPreviewZoomImage(true)}
          />
        </div>
      </Dialog>

      {/* Header image at full size */}
      <Dialog open={previewZoomImage && Boolean(headerImageUrl)} onClose={() => setPreviewZoomImage(false)} title="Header image" size="2xl">
        <img src={headerImageUrl} alt="Header at full resolution" className="mx-auto max-h-[70vh] w-auto rounded-md object-contain" />
        {imageMeta.label && <p className="mt-2 text-center text-xs text-gray-500">{imageMeta.label}</p>}
      </Dialog>
    </Page>
  );
}
