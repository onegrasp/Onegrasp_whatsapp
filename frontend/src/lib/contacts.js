// Built-in contact sets. Custom sets are derived from contact tags on the server.
export const BUILT_IN_SETS = [
  { value: "test_contacts", label: "Test contacts" },
  { value: "new_contacts", label: "New contacts" },
];

// Status labels a contact can carry.
export const STATUS_LABELS = [
  { value: "interested", label: "Interested" },
  { value: "follow_up", label: "Follow up" },
  { value: "converted", label: "Converted" },
  { value: "not_interested", label: "Not interested" },
];

const KNOWN_KEYS = new Set([
  "all",
  "none",
  ...BUILT_IN_SETS.map((s) => s.value),
  ...STATUS_LABELS.map((l) => l.value),
]);

// Custom set names from the /contacts/sets response.
export const customSetsFrom = (counts = {}) => Object.keys(counts).filter((key) => !KNOWN_KEYS.has(key));

// "test_contacts" -> "Test contacts", "onegrasp1" -> "Onegrasp1".
export const formatSetName = (value) => {
  if (!value || value === "none") return "None";
  const builtIn = [...BUILT_IN_SETS, ...STATUS_LABELS].find((s) => s.value === value);
  if (builtIn) return builtIn.label;
  const text = value.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const SAMPLE_CSV = "name,country_code,phone\nJohn Doe,91,9876543210\nJane Smith,1,4155238886\n";

export const downloadSampleCsv = () => {
  const blob = new Blob([SAMPLE_CSV], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "contacts_template.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export const UPLOAD_ACCEPT = ".csv,.xlsx,.xls,.xlsb,.xlsm,.ods,.xml,.txt,.tsv,.prn";
