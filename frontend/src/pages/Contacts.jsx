import { useCallback, useEffect, useState } from "react";
import { Download, Plus, Search, Trash2, Upload, Users } from "lucide-react";
import {
  getContacts,
  getContactSets,
  assignContactSet,
  updateContactLabel,
  deleteContact,
  addSingleContact,
  deleteBulkContacts,
} from "../services/api";
import { Dialog, EmptyState, ErrorState, Field, LoadingRows, Page, PageHeader } from "../components/ui";
import { useConfirm, useToast } from "../components/feedback";
import ImportContactsDialog from "../components/ImportContactsDialog";
import { BUILT_IN_SETS, STATUS_LABELS, customSetsFrom, downloadSampleCsv, formatSetName } from "../lib/contacts";
import { errorMessage, formatDate, formatNumber } from "../lib/format";

const PAGE_SIZE = 50;

function AddContactDialog({ open, onClose, sets, defaultSet, onSaved }) {
  const [name, setName] = useState("");
  const [countryCode, setCountryCode] = useState("91");
  const [phone, setPhone] = useState("");
  const [targetSet, setTargetSet] = useState(defaultSet);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      setPhone("");
      setError("");
      setTargetSet(defaultSet);
    }
  }, [open, defaultSet]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!phone.trim()) return;
    setSaving(true);
    setError("");
    try {
      await addSingleContact({ name, phone, countryCode, set: targetSet });
      onSaved();
    } catch (err) {
      setError(errorMessage(err, "The contact could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add contact"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="add-contact-form" className="btn btn-primary" disabled={saving || !phone.trim()}>
            {saving ? "Saving…" : "Save contact"}
          </button>
        </>
      }
    >
      <form id="add-contact-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="Name">
          {(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />}
        </Field>
        <div>
          <label htmlFor="contact-phone" className="label">
            Phone number
          </label>
          <div className="flex gap-2">
            <div className="relative w-24 shrink-0">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">+</span>
              <input
                aria-label="Country code"
                className="input pl-6 tabular-nums"
                inputMode="numeric"
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value.replace(/[^\d]/g, "").slice(0, 4))}
              />
            </div>
            <input
              id="contact-phone"
              className="input tabular-nums"
              inputMode="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="98765 43210"
              aria-invalid={Boolean(error)}
            />
          </div>
          <p className="hint">If the number already starts with + and a country code, the code on the left is ignored.</p>
        </div>
        <Field label="Set">
          {(id) => (
            <select id={id} className="input" value={targetSet} onChange={(e) => setTargetSet(e.target.value)}>
              {sets.map((s) => (
                <option key={s} value={s}>
                  {formatSetName(s)}
                </option>
              ))}
            </select>
          )}
        </Field>
        {error && <ErrorState message={error} />}
      </form>
    </Dialog>
  );
}

function NewSetDialog({ open, onClose, selectedCount, onCreate }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    await onCreate(name);
    setSaving(false);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New set"
      description="Group contacts for targeted campaigns."
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="new-set-form" className="btn btn-primary" disabled={saving || !name.trim()}>
            Create set
          </button>
        </>
      }
    >
      <form id="new-set-form" onSubmit={handleSubmit}>
        <Field
          label="Set name"
          hint={
            selectedCount > 0
              ? `The ${selectedCount} selected contact${selectedCount === 1 ? "" : "s"} will be added to this set.`
              : "A set without contacts disappears when you leave the page. Select contacts first to keep it."
          }
        >
          {(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Webinar attendees" />}
        </Field>
      </form>
    </Dialog>
  );
}

export default function Contacts() {
  const toast = useToast();
  const confirm = useConfirm();
  const [contacts, setContacts] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [filterSet, setFilterSet] = useState("all");
  const [setCounts, setSetCounts] = useState({});
  // Sets come from contact tags on the server. Sets created this session stay
  // in state until they have contacts.
  const [customSets, setCustomSets] = useState([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [dialog, setDialog] = useState(null); // "add" | "set" | "import"

  const loadSets = useCallback(async () => {
    try {
      const res = await getContactSets();
      const counts = res.data?.sets || {};
      setSetCounts(counts);
      setCustomSets((prev) => Array.from(new Set([...prev, ...customSetsFrom(counts)])));
    } catch (err) {
      console.error("Failed to load contact sets:", err);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await getContacts({
        search,
        set: filterSet !== "all" ? filterSet : undefined,
        page,
        limit: PAGE_SIZE,
      });
      setContacts(res.data.contacts || []);
      setTotal(res.data.total || 0);
      setSelectedIds([]);
    } catch (err) {
      console.error(err);
      setLoadError("Contacts could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [search, filterSet, page]);

  useEffect(() => {
    loadSets();
  }, [loadSets]);

  useEffect(() => {
    load();
  }, [load]);

  const refreshAll = () => {
    load();
    loadSets();
  };

  const allSets = [...BUILT_IN_SETS.map((s) => s.value), ...customSets];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selected = new Set(selectedIds);
  const allOnPageSelected = contacts.length > 0 && selectedIds.length === contacts.length;

  const toggleOne = (id) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const assignSelected = async (setName) => {
    if (!setName || selectedIds.length === 0) return;
    try {
      await assignContactSet({ contactIds: selectedIds, setName });
      toast.success(`Added ${selectedIds.length} contact${selectedIds.length === 1 ? "" : "s"} to ${formatSetName(setName)}`);
      refreshAll();
    } catch (err) {
      toast.error(`Could not add to set: ${errorMessage(err)}`);
    }
  };

  const deleteSelected = async () => {
    const count = selectedIds.length;
    const ok = await confirm({
      title: `Delete ${count} contact${count === 1 ? "" : "s"}?`,
      message: "They will be removed from all sets and won't receive campaigns.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteBulkContacts(selectedIds);
      toast.success(`Deleted ${count} contact${count === 1 ? "" : "s"}`);
      refreshAll();
    } catch (err) {
      toast.error(`Could not delete contacts: ${errorMessage(err)}`);
    }
  };

  const deleteOne = async (contact) => {
    const ok = await confirm({
      title: "Delete contact?",
      message: `${contact.name} (${contact.phone}) will be removed.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteContact(contact._id);
      setContacts((prev) => prev.filter((c) => c._id !== contact._id));
      setTotal((t) => t - 1);
      loadSets();
      toast.success("Contact deleted");
    } catch (err) {
      toast.error(`Could not delete contact: ${errorMessage(err)}`);
    }
  };

  const changeLabel = async (id, label) => {
    try {
      await updateContactLabel(id, label);
      setContacts((prev) => prev.map((c) => (c._id === id ? { ...c, label } : c)));
      loadSets();
    } catch (err) {
      toast.error(`Could not update label: ${errorMessage(err)}`);
    }
  };

  const createSet = async (rawName) => {
    const cleanName = rawName.trim().toLowerCase().replace(/\s+/g, "_");
    try {
      if (selectedIds.length > 0) {
        await assignContactSet({ contactIds: selectedIds, setName: cleanName });
      }
      setCustomSets((prev) => Array.from(new Set([...prev, cleanName])));
      setFilterSet(cleanName);
      setPage(1);
      setDialog(null);
      toast.success(`Set "${formatSetName(cleanName)}" created`);
      loadSets();
    } catch (err) {
      toast.error(`Could not create set: ${errorMessage(err)}`);
    }
  };

  const selectSet = (value) => {
    setFilterSet(value);
    setPage(1);
  };

  const tabs = [{ value: "all", label: "All contacts" }, ...allSets.map((s) => ({ value: s, label: formatSetName(s) }))];
  const defaultDialogSet = filterSet !== "all" ? filterSet : "test_contacts";
  const firstRow = (page - 1) * PAGE_SIZE + 1;
  const lastRow = Math.min(page * PAGE_SIZE, total);

  return (
    <Page
      header={
        <PageHeader
          title="Contacts"
          description="Organise contacts into sets for targeted campaigns."
          actions={
            <>
              <button type="button" className="btn btn-ghost" onClick={downloadSampleCsv}>
                <Download size={14} aria-hidden="true" />
                Template
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setDialog("import")}>
                <Upload size={14} aria-hidden="true" />
                Import
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setDialog("add")}>
                <Plus size={14} aria-hidden="true" />
                Add contact
              </button>
            </>
          }
        >
          <div className="-mb-4 mt-4 flex items-end gap-1 overflow-x-auto" role="tablist" aria-label="Contact sets">
            {tabs.map((tab) => {
              const active = filterSet === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => selectSet(tab.value)}
                  className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1 text-sm transition-colors ${
                    active ? "border-brand-600 font-medium text-gray-900" : "border-transparent text-gray-500 hover:text-gray-800"
                  }`}
                >
                  {tab.label}
                  <span className={`text-xs tabular-nums ${active ? "text-gray-600" : "text-gray-400"}`}>{formatNumber(setCounts[tab.value] || 0)}</span>
                </button>
              );
            })}
            <button type="button" onClick={() => setDialog("set")} className="flex shrink-0 items-center gap-1 px-3 pb-2.5 pt-1 text-sm text-brand-700 hover:text-brand-800">
              <Plus size={14} aria-hidden="true" />
              New set
            </button>
          </div>
        </PageHeader>
      }
    >
      <div className="mb-3 flex min-h-[36px] flex-wrap items-center justify-between gap-3">
        {selectedIds.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-gray-900">{selectedIds.length} selected</span>
            <select
              aria-label="Add selected contacts to set"
              className="input input-sm w-auto"
              value=""
              onChange={(e) => assignSelected(e.target.value)}
            >
              <option value="">Add to set…</option>
              {allSets.map((s) => (
                <option key={s} value={s}>
                  {formatSetName(s)}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-danger-ghost btn-sm" onClick={deleteSelected}>
              <Trash2 size={14} aria-hidden="true" />
              Delete
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelectedIds([])}>
              Clear selection
            </button>
          </div>
        ) : (
          <div className="relative w-full sm:w-72">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            <input
              type="search"
              aria-label="Search contacts"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search name or phone"
              className="input pl-8"
            />
          </div>
        )}
        <p className="text-xs text-gray-500 tabular-nums">{formatNumber(total)} contacts</p>
      </div>

      {loadError && (
        <div className="mb-3">
          <ErrorState message={loadError} onRetry={load} />
        </div>
      )}

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table table-hover">
            <thead>
              <tr>
                <th className="w-10">
                  <input
                    type="checkbox"
                    className="checkbox"
                    aria-label="Select all contacts on this page"
                    checked={allOnPageSelected}
                    onChange={(e) => setSelectedIds(e.target.checked ? contacts.map((c) => c._id) : [])}
                  />
                </th>
                <th>Name</th>
                <th>Phone</th>
                <th>Set / label</th>
                <th>Added</th>
                <th className="w-12" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <LoadingRows rows={8} cols={6} />
              ) : contacts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="h-auto">
                    <EmptyState
                      icon={Users}
                      title={search ? "No matching contacts" : "No contacts in this set"}
                      description={search ? "Try a different name or number." : "Import a file or add contacts one at a time."}
                      action={
                        !search && (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog("import")}>
                            Import contacts
                          </button>
                        )
                      }
                    />
                  </td>
                </tr>
              ) : (
                contacts.map((c) => (
                  <tr key={c._id} className={selected.has(c._id) ? "bg-brand-50/40" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        className="checkbox"
                        aria-label={`Select ${c.name}`}
                        checked={selected.has(c._id)}
                        onChange={() => toggleOne(c._id)}
                      />
                    </td>
                    <td className="whitespace-nowrap font-medium text-gray-900">{c.name}</td>
                    <td className="num whitespace-nowrap">{c.phone}</td>
                    <td>
                      <select
                        aria-label={`Set or label for ${c.name}`}
                        value={c.label || "none"}
                        onChange={(e) => changeLabel(c._id, e.target.value)}
                        className="input input-sm h-7 w-auto min-w-[140px] border-transparent bg-transparent shadow-none hover:border-gray-300"
                      >
                        <option value="none">None</option>
                        <optgroup label="Sets">
                          {allSets.map((s) => (
                            <option key={s} value={s}>
                              {formatSetName(s)}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Status">
                          {STATUS_LABELS.map((l) => (
                            <option key={l.value} value={l.value}>
                              {l.label}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </td>
                    <td className="whitespace-nowrap text-gray-500">{formatDate(c.createdAt)}</td>
                    <td className="text-right">
                      <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => deleteOne(c)} aria-label={`Delete ${c.name}`}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-2.5">
            <p className="text-xs text-gray-500 tabular-nums">
              {formatNumber(firstRow)}–{formatNumber(lastRow)} of {formatNumber(total)}
            </p>
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                Previous
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      <AddContactDialog
        open={dialog === "add"}
        onClose={() => setDialog(null)}
        sets={allSets}
        defaultSet={defaultDialogSet}
        onSaved={() => {
          setDialog(null);
          toast.success("Contact added");
          refreshAll();
        }}
      />
      <NewSetDialog open={dialog === "set"} onClose={() => setDialog(null)} selectedCount={selectedIds.length} onCreate={createSet} />
      <ImportContactsDialog
        open={dialog === "import"}
        onClose={() => setDialog(null)}
        defaultSet={filterSet}
        customSets={customSets}
        onImported={refreshAll}
      />
    </Page>
  );
}
