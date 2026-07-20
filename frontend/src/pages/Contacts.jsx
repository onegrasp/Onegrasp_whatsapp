import { useState, useEffect, useRef } from "react";
import {
  Search,
  Trash2,
  Tag,
  ChevronDown,
  Plus,
  Users,
  CheckSquare,
  Sparkles,
  FolderPlus,
  UserPlus,
  Upload,
  Loader2,
  CheckCircle,
  AlertCircle,
  X,
} from "lucide-react";
import {
  getContacts,
  getContactSets,
  assignContactSet,
  updateContactLabel,
  deleteContact,
  addSingleContact,
  deleteBulkContacts,
  uploadContacts,
} from "../services/api";

const DEFAULT_SETS = [
  { value: "all", label: "All Contacts", icon: "🌐" },
  { value: "test_contacts", label: "Test Contacts", icon: "🧪" },
  { value: "new_contacts", label: "Set of New Contacts", icon: "🆕" },
];

const LABELS = [
  { value: "none", label: "No Label", color: "text-slate-400" },
  { value: "test_contacts", label: "Test Contacts", color: "text-purple-600" },
  { value: "new_contacts", label: "New Contacts", color: "text-emerald-600" },
  { value: "interested", label: "Interested", color: "text-wa-green" },
  { value: "follow_up", label: "Follow Up", color: "text-yellow-600" },
  { value: "converted", label: "Converted", color: "text-blue-600" },
  { value: "not_interested", label: "Not Interested", color: "text-red-500" },
];

const LABEL_COLORS = {
  none: "bg-slate-100 text-slate-600",
  test_contacts: "bg-purple-100 text-purple-800 border border-purple-200",
  new_contacts: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  interested: "bg-wa-green/20 text-wa-green",
  follow_up: "bg-amber-100 text-amber-800",
  converted: "bg-blue-100 text-blue-800",
  not_interested: "bg-rose-100 text-rose-800",
};

export default function Contacts() {
  const [contacts, setContacts] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [filterSet, setFilterSet] = useState("all");
  const [filterLabel, setFilterLabel] = useState("all");
  const [setCounts, setSetCounts] = useState({});
  const [customSets, setCustomSets] = useState(() => {
    try {
      const saved = localStorage.getItem("wa_custom_contact_sets");
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  // Modals & UI States
  const [showNewSetModal, setShowNewSetModal] = useState(false);
  const [showSingleModal, setShowSingleModal] = useState(false);
  const [newSetName, setNewSetName] = useState("");
  const [assigningSet, setAssigningSet] = useState("");
  const [singleName, setSingleName] = useState("");
  const [singlePhone, setSinglePhone] = useState("");
  const [singleTargetSet, setSingleTargetSet] = useState("test_contacts");
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadTargetSet, setUploadTargetSet] = useState("all");

  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const fileRef = useRef(null);
  const limit = 50;

  useEffect(() => {
    loadSets();
  }, []);

  useEffect(() => {
    load();
  }, [search, filterSet, filterLabel, page]);

  const loadSets = async () => {
    try {
      const res = await getContactSets();
      const counts = res.data?.sets || {};
      setSetCounts(counts);

      const known = ["all", "test_contacts", "new_contacts", "none", "interested", "follow_up", "converted", "not_interested"];
      const dbCustom = Object.keys(counts).filter((k) => !known.includes(k));

      setCustomSets((prev) => {
        const merged = Array.from(new Set([...prev, ...dbCustom]));
        localStorage.setItem("wa_custom_contact_sets", JSON.stringify(merged));
        return merged;
      });
    } catch (err) {
      console.error("Failed to load contact sets:", err);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await getContacts({
        search,
        set: filterSet !== "all" ? filterSet : undefined,
        label: filterLabel !== "all" ? filterLabel : undefined,
        page,
        limit,
      });
      setContacts(res.data.contacts || []);
      setTotal(res.data.total || 0);
      setSelectedIds([]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedIds(contacts.map((c) => c._id));
    } else {
      setSelectedIds([]);
    }
  };

  const toggleSelectOne = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleAssignSelectedToSet = async (targetSet) => {
    if (!targetSet || selectedIds.length === 0) return;
    try {
      await assignContactSet({ contactIds: selectedIds, setName: targetSet });
      load();
      loadSets();
      setAssigningSet("");
    } catch (err) {
      alert("Failed to assign set: " + (err.response?.data?.error || err.message));
    }
  };

  const handleDeleteBulk = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} selected contacts?`)) return;

    try {
      await deleteBulkContacts(selectedIds);
      load();
      loadSets();
    } catch (err) {
      alert("Failed to delete contacts: " + (err.response?.data?.error || err.message));
    }
  };

  const handleCreateNewSet = async (e) => {
    e.preventDefault();
    if (!newSetName.trim()) return;
    const cleanName = newSetName.trim().toLowerCase().replace(/\s+/g, "_");

    try {
      if (selectedIds.length > 0) {
        await assignContactSet({ contactIds: selectedIds, setName: cleanName });
      }
      setCustomSets((prev) => {
        const updated = Array.from(new Set([...prev, cleanName]));
        localStorage.setItem("wa_custom_contact_sets", JSON.stringify(updated));
        return updated;
      });
      setFilterSet(cleanName);
      setUploadTargetSet(cleanName);
      setSingleTargetSet(cleanName);
      setNewSetName("");
      setShowNewSetModal(false);
      load();
      loadSets();
    } catch (err) {
      alert("Failed to create set: " + (err.response?.data?.error || err.message));
    }
  };

  const handleAddSingleContact = async (e) => {
    e.preventDefault();
    if (!singlePhone.trim()) return;

    try {
      await addSingleContact({
        name: singleName,
        phone: singlePhone,
        set: singleTargetSet,
      });
      setSingleName("");
      setSinglePhone("");
      setShowSingleModal(false);
      load();
      loadSets();
    } catch (err) {
      alert("Failed to add contact: " + (err.response?.data?.error || err.message));
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    setUploadResult(null);

    const fd = new FormData();
    fd.append("file", file);
    if (uploadTargetSet && uploadTargetSet !== "all") {
      fd.append("targetSet", uploadTargetSet);
    }

    try {
      const res = await uploadContacts(fd);
      setUploadResult(res.data);
      load();
      loadSets();
    } catch (err) {
      alert("Upload failed: " + (err.response?.data?.error || err.message));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleLabelChange = async (id, label) => {
    try {
      await updateContactLabel(id, label);
      setContacts((prev) =>
        prev.map((c) => (c._id === id ? { ...c, label } : c))
      );
      loadSets();
    } catch (err) {
      alert("Failed to update label");
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this contact?")) return;
    try {
      await deleteContact(id);
      setContacts((prev) => prev.filter((c) => c._id !== id));
      setTotal((t) => t - 1);
      loadSets();
    } catch (err) {
      alert("Failed to delete contact");
    }
  };

  const totalPages = Math.ceil(total / limit);
  const selectedSet = new Set(selectedIds);

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5 bg-slate-50/50 will-change-scroll">
      {/* Top Title & Search Bar */}
      <div className="flex items-center justify-between flex-wrap gap-4 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
        <div>
          <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Users size={18} className="text-wa-green" />
            Contact Sets & Audiences
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Organize contacts into sets for targeted bulk broadcasts and event messaging.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search name or phone..."
              className="w-48 bg-slate-50 border border-slate-200 rounded-xl py-1.5 pl-8 pr-3 text-xs focus:outline-none focus:border-wa-green text-slate-700"
            />
          </div>

          {/* Add Single Contact Button */}
          <button
            onClick={() => setShowSingleModal(true)}
            className="bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all active:scale-[0.98]"
          >
            <UserPlus size={14} />
            + Single Contact
          </button>

          {/* Upload Button */}
          <div className="flex items-center gap-1">
            <select
              value={uploadTargetSet}
              onChange={(e) => setUploadTargetSet(e.target.value)}
              className="bg-slate-100 border border-slate-200 rounded-xl py-1.5 px-2 text-[11px] font-semibold text-slate-700 outline-none"
              title="Select which set to add bulk upload contacts into"
            >
              <option value="all">Set: None / Auto</option>
              <option value="test_contacts">Set: Test Contacts</option>
              <option value="new_contacts">Set: New Contacts</option>
              {customSets.map((cs) => (
                <option key={cs} value={cs}>
                  Set: {cs.replace(/_/g, " ").toUpperCase()}
                </option>
              ))}
            </select>
            <button
              onClick={() => fileRef.current.click()}
              disabled={uploading}
              className="bg-wa-green hover:bg-wa-green-hover text-white px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all active:scale-[0.98]"
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Bulk Upload
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls,.xlsb,.xlsm,.ods,.xml,.txt,.tsv,.prn"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>

          {/* New Set Button */}
          <button
            onClick={() => setShowNewSetModal(true)}
            className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all active:scale-[0.98]"
          >
            <FolderPlus size={14} />
            + New Set
          </button>
        </div>
      </div>

      {/* Upload Summary Popup / Banner */}
      {uploadResult && (
        <div className="bg-wa-green/10 border border-wa-green/30 p-4 rounded-2xl flex items-center justify-between gap-3 animate-fade-in shadow-sm">
          <div className="flex items-center gap-3">
            <CheckCircle size={20} className="text-wa-green shrink-0" />
            <div className="text-xs space-y-0.5">
              <p className="font-bold text-slate-800 text-xs">Bulk Upload Completed!</p>
              <p className="text-slate-600">
                <strong className="text-wa-green font-bold">{uploadResult.added} new contacts added</strong>
                {uploadResult.targetSet && uploadResult.targetSet !== "none" && (
                  <span> to set <code className="bg-white px-1.5 py-0.5 rounded border text-slate-700 font-bold">{uploadResult.targetSet}</code></span>
                )}
                .
              </p>
              {uploadResult.duplicates > 0 && (
                <p className="text-amber-700 font-semibold">
                  ⚠️ {uploadResult.duplicates} duplicate numbers in file/database were updated without duplication.
                </p>
              )}
            </div>
          </div>
          <button onClick={() => setUploadResult(null)} className="text-slate-400 hover:text-slate-600 p-1">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Contact Sets Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-slate-200/60 scrollbar-none">
        {DEFAULT_SETS.map((s) => {
          const count = setCounts[s.value] || 0;
          const active = filterSet === s.value;
          return (
            <button
              key={s.value}
              onClick={() => {
                setFilterSet(s.value);
                setUploadTargetSet(s.value);
                setSingleTargetSet(s.value !== "all" ? s.value : "test_contacts");
                setPage(1);
              }}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all shrink-0 select-none ${
                active
                  ? "bg-wa-green text-slate-900 shadow-sm font-bold"
                  : "bg-white border border-slate-200/80 text-slate-600 hover:bg-slate-100"
              }`}
            >
              <span>{s.icon}</span>
              <span>{s.label}</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                active ? "bg-slate-900/10 text-slate-900" : "bg-slate-100 text-slate-500"
              }`}>
                {count}
              </span>
            </button>
          );
        })}

        {/* Custom Created Sets */}
        {customSets.map((setName) => {
          const count = setCounts[setName] || 0;
          const active = filterSet === setName;
          const labelDisplay = setName.replace(/_/g, " ").toUpperCase();
          return (
            <button
              key={setName}
              onClick={() => {
                setFilterSet(setName);
                setUploadTargetSet(setName);
                setSingleTargetSet(setName);
                setPage(1);
              }}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all shrink-0 select-none ${
                active
                  ? "bg-wa-green text-slate-900 shadow-sm font-bold"
                  : "bg-white border border-slate-200/80 text-slate-600 hover:bg-slate-100"
              }`}
            >
              <span>🏷️</span>
              <span>{labelDisplay}</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                active ? "bg-slate-900/10 text-slate-900" : "bg-slate-100 text-slate-500"
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Bulk Action Bar (when rows are checked) */}
      {selectedIds.length > 0 && (
        <div className="bg-wa-green/10 border border-wa-green/30 p-3 rounded-2xl flex items-center justify-between gap-3 animate-fade-in">
          <div className="flex items-center gap-2 text-xs font-bold text-wa-green">
            <CheckSquare size={16} />
            <span>{selectedIds.length} contacts selected</span>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={assigningSet}
              onChange={(e) => {
                const val = e.target.value;
                setAssigningSet(val);
                if (val) handleAssignSelectedToSet(val);
              }}
              className="bg-white border border-slate-200 text-slate-700 rounded-xl px-3 py-1 text-xs font-semibold outline-none"
            >
              <option value="">Add selected to Set...</option>
              <option value="test_contacts">🧪 Test Contacts</option>
              <option value="new_contacts">🆕 Set of New Contacts</option>
              {customSets.map((cs) => (
                <option key={cs} value={cs}>🏷️ {cs.replace(/_/g, " ").toUpperCase()}</option>
              ))}
            </select>

            {/* Multiple Delete Button */}
            <button
              onClick={handleDeleteBulk}
              className="bg-rose-500 hover:bg-rose-600 text-white px-3 py-1 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors"
            >
              <Trash2 size={13} />
              Delete Selected ({selectedIds.length})
            </button>
          </div>
        </div>
      )}

      {/* Contacts Table */}
      <div className="bg-white rounded-2xl border border-slate-150/80 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50/70 border-b border-slate-100 text-slate-400 font-semibold text-[11px] uppercase tracking-wider">
                <th className="px-4 py-3 text-left w-10">
                  <input
                    type="checkbox"
                    checked={selectedIds.length === contacts.length && contacts.length > 0}
                    onChange={handleSelectAll}
                    className="rounded text-wa-green focus:ring-wa-green cursor-pointer"
                  />
                </th>
                <th className="px-5 py-3 text-left">Name</th>
                <th className="px-5 py-3 text-left">Phone</th>
                <th className="px-5 py-3 text-left">Assigned Set / Label</th>
                <th className="px-5 py-3 text-left">Added Date</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array(6).fill(0).map((_, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    <td className="px-5 py-3" colSpan={6}>
                      <div className="h-4 bg-slate-100 rounded animate-pulse w-full" />
                    </td>
                  </tr>
                ))
              ) : contacts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-slate-400 text-xs">
                    No contacts found in this set. Upload a file or add contacts to get started.
                  </td>
                </tr>
              ) : (
                contacts.map((c) => {
                  const isChecked = selectedSet.has(c._id);
                  return (
                    <tr
                      key={c._id}
                      className={`border-b border-slate-50 hover:bg-slate-50/80 ${
                        isChecked ? "bg-wa-green/5" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelectOne(c._id)}
                          className="rounded text-wa-green focus:ring-wa-green cursor-pointer"
                        />
                      </td>
                      <td className="px-5 py-3 text-slate-900 font-semibold text-xs">{c.name}</td>
                      <td className="px-5 py-3 text-slate-500 font-mono text-xs">{c.phone}</td>
                      <td className="px-5 py-3">
                        <div className="relative inline-block">
                          <select
                            value={c.label || "none"}
                            onChange={(e) => handleLabelChange(c._id, e.target.value)}
                            className={`appearance-none text-[11px] font-bold px-2.5 py-0.5 rounded-lg cursor-pointer outline-none ${
                              LABEL_COLORS[c.label] || LABEL_COLORS.none
                            }`}
                          >
                            {LABELS.map((l) => (
                              <option key={l.value} value={l.value}>
                                {l.label}
                              </option>
                            ))}
                            {customSets.map((cs) => (
                              <option key={cs} value={cs}>
                                🏷️ {cs.replace(/_/g, " ").toUpperCase()}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-slate-400 text-[11px]">
                        {new Date(c.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={() => handleDelete(c._id)}
                          className="text-slate-400 hover:text-rose-500 p-1.5 rounded-lg hover:bg-rose-50 transition-colors"
                          title="Delete contact"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between bg-slate-50/40">
            <p className="text-xs text-slate-500">
              Page {page} of {totalPages} · {total} contacts
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 bg-white border border-slate-200 rounded-lg text-xs font-semibold disabled:opacity-40"
              >
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 bg-white border border-slate-200 rounded-lg text-xs font-semibold disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal: Add Single Contact */}
      {showSingleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-4 animate-scale-up">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <UserPlus size={16} className="text-wa-green" />
                Add Single Contact
              </h3>
              <button onClick={() => setShowSingleModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                ✕
              </button>
            </div>

            <form onSubmit={handleAddSingleContact} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Contact Name</label>
                <input
                  type="text"
                  placeholder="John Doe"
                  value={singleName}
                  onChange={(e) => setSingleName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-wa-green text-slate-700"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Phone Number (International / Local) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="+919876543210 or 919876543210"
                  value={singlePhone}
                  onChange={(e) => setSinglePhone(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs font-mono focus:outline-none focus:border-wa-green text-slate-700"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Target Contact Set</label>
                <select
                  value={singleTargetSet}
                  onChange={(e) => setSingleTargetSet(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-wa-green text-slate-700"
                >
                  <option value="test_contacts">🧪 Test Contacts</option>
                  <option value="new_contacts">🆕 Set of New Contacts</option>
                  {customSets.map((cs) => (
                    <option key={cs} value={cs}>
                      🏷️ {cs.replace(/_/g, " ").toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSingleModal(false)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2 rounded-xl text-xs font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-wa-green hover:bg-wa-green-hover text-white py-2 rounded-xl text-xs font-semibold transition-colors"
                >
                  Save Contact
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: New Contact Set */}
      {showNewSetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-4 animate-scale-up">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <FolderPlus size={16} className="text-wa-green" />
                Create New Contact Set
              </h3>
              <button onClick={() => setShowNewSetModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateNewSet} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Contact Set Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. AI Conference Attendees 2026"
                  value={newSetName}
                  onChange={(e) => setNewSetName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-wa-green text-slate-700"
                />
              </div>

              {selectedIds.length > 0 && (
                <p className="text-[11px] text-wa-green font-semibold">
                  ✓ {selectedIds.length} currently selected contacts will be added to this set automatically.
                </p>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewSetModal(false)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2 rounded-xl text-xs font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-wa-green hover:bg-wa-green-hover text-white py-2 rounded-xl text-xs font-semibold transition-colors"
                >
                  Create Set
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
