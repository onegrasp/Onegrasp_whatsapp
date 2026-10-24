import { useEffect, useRef, useState } from "react";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { uploadContacts } from "../services/api";
import { Badge, Dialog, ErrorState, Field } from "./ui";
import ConsentFields from "./ConsentFields";
import { BUILT_IN_SETS, MAX_UPLOAD_MB, UPLOAD_ACCEPT, downloadSampleCsv, formatSetName } from "../lib/contacts";
import { errorMessage, formatNumber } from "../lib/format";

const ISSUE_TONE = { invalid: "danger", duplicate: "warning", existing: "neutral", warning: "info" };
const ISSUE_LABEL = { invalid: "Not imported", duplicate: "Duplicate in file", existing: "Already saved", warning: "Imported with note" };

function Summary({ result }) {
  const rows = [
    { label: "New contacts added", value: result.added, strong: true },
    { label: result.targetSet && result.targetSet !== "none" ? "Already saved (added to set)" : "Already saved (not changed)", value: result.existing },
    { label: "Duplicates in the file", value: result.duplicatesInFile },
    { label: "Rows with problems", value: result.invalid, danger: true },
  ].filter((r) => r.value !== undefined);

  return (
    <dl className="divide-y divide-gray-100 rounded-md border border-gray-200">
      <div className="flex items-center justify-between px-3 py-2 text-sm">
        <dt className="text-gray-500">Rows in file</dt>
        <dd className="tabular-nums text-gray-900">{formatNumber(result.total)}</dd>
      </div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between px-3 py-2 text-sm">
          <dt className="text-gray-500">{r.label}</dt>
          <dd className={`tabular-nums ${r.strong ? "font-semibold text-gray-900" : r.danger && r.value > 0 ? "font-medium text-red-600" : "text-gray-900"}`}>
            {formatNumber(r.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function IssuesTable({ issues, total }) {
  if (!issues || issues.length === 0) return null;
  return (
    <div className="mt-5">
      <h3 className="section-title">Row details</h3>
      <p className="mt-0.5 text-xs text-gray-500">Row numbers match your spreadsheet (row 1 is the header).</p>
      <div className="mt-2 max-h-72 overflow-auto rounded-md border border-gray-200">
        <table className="table">
          <thead className="sticky top-0">
            <tr>
              <th className="w-14">Row</th>
              <th>Name</th>
              <th>Phone</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue, i) => (
              <tr key={`${issue.row}-${i}`}>
                <td className="num text-gray-500">{issue.row}</td>
                <td className="max-w-[140px] truncate text-gray-900" title={issue.name}>
                  {issue.name || "—"}
                </td>
                <td className="num whitespace-nowrap">{issue.value || "—"}</td>
                <td className="min-w-[220px] py-2">
                  <Badge tone={ISSUE_TONE[issue.type] || "neutral"}>{ISSUE_LABEL[issue.type] || "Note"}</Badge>
                  <p className="mt-1 text-xs text-gray-600">{issue.reason}</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > issues.length && (
        <p className="mt-2 text-xs text-gray-500">
          Showing the first {issues.length} of {formatNumber(total)} rows with notes.
        </p>
      )}
    </div>
  );
}

export default function ImportContactsDialog({ open, onClose, defaultSet = "all", customSets = [], onImported }) {
  const fileRef = useRef(null);
  const [targetSet, setTargetSet] = useState(defaultSet);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const [consentSource, setConsentSource] = useState("");

  useEffect(() => {
    if (open) {
      setTargetSet(defaultSet && defaultSet !== "all" ? defaultSet : "all");
      setFile(null);
      setResult(null);
      setError("");
      setConsent(false);
      setConsentSource("");
    }
  }, [open, defaultSet]);

  const reset = () => {
    setFile(null);
    setResult(null);
    setError("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleImport = async (e) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError("");
    const fd = new FormData();
    fd.append("file", file);
    if (targetSet && targetSet !== "all") fd.append("targetSet", targetSet);
    if (consent) {
      fd.append("consent", "true");
      fd.append("consentSource", consentSource.trim());
    }
    try {
      const res = await uploadContacts(fd);
      setResult(res.data);
      onImported?.(res.data);
    } catch (err) {
      setError(errorMessage(err, "The file could not be imported."));
    } finally {
      setUploading(false);
    }
  };

  const setOptions = [...BUILT_IN_SETS.map((s) => s.value), ...customSets.filter((s) => !BUILT_IN_SETS.some((b) => b.value === s))];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={result ? "Import finished" : "Import contacts"}
      description={result ? undefined : "Upload a CSV or Excel file with one contact per row."}
      size="xl"
      footer={
        result ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={reset}>
              Import another file
            </button>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" form="import-form" className="btn btn-primary" disabled={!file || uploading || (consent && !consentSource.trim())}>
              {uploading ? "Importing…" : "Import"}
            </button>
          </>
        )
      }
    >
      {result ? (
        <>
          <Summary result={result} />
          {result.consentRecorded && <p className="mt-3 text-13 text-gray-600">Consent recorded for the imported contacts.</p>}
          {result.consentNotSaved && (
            <div className="mt-3">
              <ErrorState message="Contacts were imported, but consent couldn't be stored yet. Run migration 005_sending_safeguards.sql in Supabase, then record consent from the Contacts page." />
            </div>
          )}
          <IssuesTable issues={result.issues} total={result.issuesTotal} />
        </>
      ) : (
        <form id="import-form" onSubmit={handleImport} className="space-y-5">
          <Field label="Add contacts to set">
            {(id) => (
              <select id={id} className="input" value={targetSet} onChange={(e) => setTargetSet(e.target.value)}>
                <option value="all">No set</option>
                {setOptions.map((s) => (
                  <option key={s} value={s}>
                    {formatSetName(s)}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <div>
            <span className="label">File</span>
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-gray-300 px-4 py-4">
              <FileSpreadsheet size={20} className="text-gray-400" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-gray-900">{file ? file.name : "No file selected"}</p>
                <p className="text-xs text-gray-500">CSV, Excel (.xlsx, .xls) or ODS, up to {MAX_UPLOAD_MB} MB</p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
                <Upload size={14} aria-hidden="true" />
                {file ? "Change file" : "Choose file"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept={UPLOAD_ACCEPT}
                className="sr-only"
                onChange={(e) => {
                  const picked = e.target.files?.[0] || null;
                  if (picked && picked.size > MAX_UPLOAD_MB * 1024 * 1024) {
                    setFile(null);
                    e.target.value = "";
                    setError(`This file is larger than ${MAX_UPLOAD_MB} MB. Split it into smaller files and import them one at a time.`);
                    return;
                  }
                  setFile(picked);
                  setError("");
                }}
              />
            </div>
          </div>

          <div className="rounded-md bg-gray-50 px-4 py-3 text-13 text-gray-600">
            <p className="font-medium text-gray-900">File format</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4">
              <li>
                Columns: <strong className="font-medium text-gray-800">Name</strong>, <strong className="font-medium text-gray-800">Country Code</strong> (e.g. 91) and{" "}
                <strong className="font-medium text-gray-800">Phone</strong>. Country Code is optional if numbers already include it; numbers
                without one get the default country code (+91), so add it for contacts in other countries.
              </li>
              <li>In Excel, format the Phone column as Text before typing numbers, so long numbers aren't rounded.</li>
              <li>Numbers already in your contacts are reported, not duplicated.</li>
            </ul>
            <button type="button" onClick={downloadSampleCsv} className="mt-2 inline-flex items-center gap-1.5 font-medium text-brand-700 hover:text-brand-800">
              <Download size={14} aria-hidden="true" />
              Download template
            </button>
          </div>

          <ConsentFields
            consent={consent}
            setConsent={setConsent}
            source={consentSource}
            setSource={setConsentSource}
            label="Everyone in this file agreed to receive WhatsApp messages from us"
          />

          {error && <ErrorState message={error} />}
        </form>
      )}
    </Dialog>
  );
}
