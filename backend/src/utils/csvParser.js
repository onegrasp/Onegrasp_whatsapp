const XLSX = require("xlsx");
const { parse } = require("csv-parse/sync");
const { validateAndFormatE164 } = require("./phone");

/**
 * Universal Spreadsheet & CSV Parser for Bulk Contacts Upload
 * Fixes number precision truncation (prevents numbers from ending in 000000)
 */

const PHONE_HEADER_PATTERNS = [
  "phone",
  "phonenumber",
  "mobile",
  "mobilenumber",
  "number",
  "phoneno",
  "mobileno",
  "num",
  "tel",
  "telephone",
  "cell",
  "cellphone",
  "whatsapp",
  "whatsappnumber",
  "contact",
  "contactnumber",
  "phone1",
  "mobile1",
  "primaryphone",
  "msisdn",
];

const NAME_HEADER_PATTERNS = [
  "name",
  "fullname",
  "contactname",
  "customername",
  "clientname",
  "personname",
  "client",
  "customer",
  "user",
  "displayname",
];

const FIRST_NAME_PATTERNS = ["firstname", "first", "givenname"];
const LAST_NAME_PATTERNS = ["lastname", "last", "surname", "familyname"];
const LABEL_PATTERNS = ["label", "tag", "tags", "category", "group", "type", "status"];

function cleanHeaderKey(key) {
  if (!key) return "";
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cleanRawPhone(raw) {
  if (raw === null || raw === undefined) return "";

  // SheetJS raw numeric cell values (e.g. 918977654321)
  if (typeof raw === "number") {
    if (isNaN(raw)) return "";
    return BigInt(Math.round(raw)).toString();
  }

  let str = String(raw).trim();

  // Strip floating point decimals from Excel (e.g., 919876543210.0 -> 919876543210)
  if (str.endsWith(".0")) {
    str = str.slice(0, -2);
  }

  // Handle scientific notation ONLY if string explicitly contains e/E (e.g., 9.19876E+11)
  if (/[eE]/.test(str)) {
    const num = Number(str);
    if (!isNaN(num)) {
      str = BigInt(Math.round(num)).toString();
    }
  }

  return str;
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/)[0] || "";
  const counts = {
    ",": (firstLine.match(/,/g) || []).length,
    ";": (firstLine.match(/;/g) || []).length,
    "\t": (firstLine.match(/\t/g) || []).length,
    "|": (firstLine.match(/\|/g) || []).length,
  };

  let bestDelim = ",";
  let maxCount = -1;
  Object.keys(counts).forEach((delim) => {
    if (counts[delim] > maxCount) {
      maxCount = counts[delim];
      bestDelim = delim;
    }
  });

  return maxCount > 0 ? bestDelim : ",";
}

const parseCSV = async (buffer) => {
  if (!buffer || buffer.length === 0) {
    return [];
  }

  let rawRows = [];

  // 1. Try reading via XLSX raw matrix mode first (.xlsx, .xls, .xlsb, .ods, .csv, etc.)
  try {
    const workbook = XLSX.read(buffer, { type: "buffer", raw: true, cellDates: false });
    if (workbook && workbook.SheetNames && workbook.SheetNames.length > 0) {
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: true, defval: "" });
      if (Array.isArray(matrix) && matrix.length > 0) {
        rawRows = matrix;
      }
    }
  } catch (xlsxErr) {
    rawRows = [];
  }

  // 2. Fallback to csv-parse on text string if raw matrix was empty or failed
  if (rawRows.length === 0) {
    let content = buffer.toString("utf-8");
    if (content.charCodeAt(0) === 0xfeff) {
      content = content.slice(1);
    }
    content = content.replace(/\0/g, "").trim();

    if (!content) return [];

    const delimiter = detectDelimiter(content);

    try {
      rawRows = parse(content, {
        delimiter,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true,
      });
    } catch (err) {
      const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
      rawRows = lines.map((line) => line.split(delimiter).map((col) => col.trim()));
    }
  }

  if (rawRows.length === 0) return [];

  const firstRow = (rawRows[0] || []).map((c) => String(c || ""));
  const normalizedHeaders = firstRow.map(cleanHeaderKey);

  let phoneColIdx = -1;
  let nameColIdx = -1;
  let firstNameColIdx = -1;
  let lastNameColIdx = -1;
  let labelColIdx = -1;

  normalizedHeaders.forEach((h, idx) => {
    if (phoneColIdx === -1 && PHONE_HEADER_PATTERNS.includes(h)) {
      phoneColIdx = idx;
    } else if (nameColIdx === -1 && NAME_HEADER_PATTERNS.includes(h)) {
      nameColIdx = idx;
    } else if (firstNameColIdx === -1 && FIRST_NAME_PATTERNS.includes(h)) {
      firstNameColIdx = idx;
    } else if (lastNameColIdx === -1 && LAST_NAME_PATTERNS.includes(h)) {
      lastNameColIdx = idx;
    } else if (labelColIdx === -1 && LABEL_PATTERNS.includes(h)) {
      labelColIdx = idx;
    }
  });

  let hasHeaders = phoneColIdx !== -1 || nameColIdx !== -1 || firstNameColIdx !== -1;
  let dataRows = [];

  if (hasHeaders) {
    dataRows = rawRows.slice(1);
  } else {
    dataRows = rawRows;
    const inspectRows = rawRows.slice(0, Math.min(10, rawRows.length));

    let bestPhoneIdx = -1;
    let maxValidPhones = -1;

    if (firstRow.length > 0) {
      for (let col = 0; col < firstRow.length; col++) {
        let validCount = 0;
        inspectRows.forEach((r) => {
          const val = cleanRawPhone(r[col]);
          const { isValid } = validateAndFormatE164(val);
          if (isValid) validCount++;
        });
        if (validCount > maxValidPhones) {
          maxValidPhones = validCount;
          bestPhoneIdx = col;
        }
      }
    }

    if (bestPhoneIdx !== -1) {
      phoneColIdx = bestPhoneIdx;
      if (firstRow.length > 1) {
        nameColIdx = bestPhoneIdx === 0 ? 1 : 0;
      }
    } else {
      phoneColIdx = firstRow.length > 1 ? 1 : 0;
      nameColIdx = phoneColIdx === 1 ? 0 : 1;
    }
  }

  const results = [];
  const seenPhones = new Set();

  dataRows.forEach((row) => {
    if (!Array.isArray(row) || row.length === 0) return;

    const rawPhone = row[phoneColIdx] !== undefined ? cleanRawPhone(row[phoneColIdx]) : "";
    if (!rawPhone) return;

    const { isValid, formatted } = validateAndFormatE164(rawPhone);
    if (!isValid || seenPhones.has(formatted)) return;

    seenPhones.add(formatted);

    let name = "Unknown";
    if (nameColIdx !== -1 && row[nameColIdx]) {
      name = String(row[nameColIdx]).trim();
    } else if (firstNameColIdx !== -1 || lastNameColIdx !== -1) {
      const fn = firstNameColIdx !== -1 && row[firstNameColIdx] ? String(row[firstNameColIdx]).trim() : "";
      const ln = lastNameColIdx !== -1 && row[lastNameColIdx] ? String(row[lastNameColIdx]).trim() : "";
      name = `${fn} ${ln}`.trim() || "Unknown";
    }

    let label = "none";
    if (labelColIdx !== -1 && row[labelColIdx]) {
      const rawLabel = String(row[labelColIdx]).trim().toLowerCase().replace(/\s+/g, "_");
      if (["interested", "follow_up", "converted", "not_interested"].includes(rawLabel)) {
        label = rawLabel;
      }
    }

    results.push({
      phone: formatted,
      name: name || formatted,
      label: label,
    });
  });

  return results;
};

module.exports = { parseCSV };
