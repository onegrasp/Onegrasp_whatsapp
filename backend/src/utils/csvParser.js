const XLSX = require("xlsx");
const { parse } = require("csv-parse/sync");
const { validateAndFormatE164, applyCountryCode, INVISIBLE_CHARS } = require("./phone");
const AppError = require("../errors/AppError");

// Upload limits: the file is held and parsed in memory.
const MAX_CONTACT_FILE_MB = 10;
const MAX_CONTACT_ROWS = 50000;

/**
 * Spreadsheet & CSV parser for bulk contact uploads.
 *
 * Every data row either becomes a contact or produces an issue with its
 * spreadsheet row number and a reason, so nothing is dropped silently.
 * Supported columns (header names are matched loosely): Name or First/Last
 * Name, Phone, and an optional Country Code.
 */

const PHONE_HEADER_PATTERNS = [
  "phone",
  "phonenumber",
  "phonenum",
  "phoneno",
  "mobile",
  "mobilenumber",
  "mobileno",
  "mobilephone",
  "number",
  "num",
  "tel",
  "telephone",
  "cell",
  "cellphone",
  "cellno",
  "whatsapp",
  "whatsappnumber",
  "whatsappno",
  "contact",
  "contactnumber",
  "contactno",
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
const COUNTRY_CODE_PATTERNS = [
  "countrycode",
  "countrycallingcode",
  "callingcode",
  "dialcode",
  "dialingcode",
  "isd",
  "isdcode",
  "cc",
  "code",
  "countryprefix",
];

const SCIENTIFIC_NOTATION = /^[+-]?(\d+)(?:\.(\d+))?e\+?(\d+)$/i;
const EXCEL_TEXT_HINT = "Format the phone column as Text in Excel, re-enter the numbers, and upload again.";

function cleanHeaderKey(key) {
  if (!key) return "";
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cleanText(value) {
  return String(value ?? "").replace(INVISIBLE_CHARS, " ").replace(/\s+/g, " ").trim();
}

/**
 * Reads one phone cell. Returns { value } with the raw number text, or
 * { error } when the value cannot be trusted, plus an optional { warning }.
 */
function readPhoneCell(raw) {
  if (raw === null || raw === undefined) return { value: "" };

  // Numeric cells from .xlsx files are exact, unless Excel already rounded
  // them (a corrupted CSV re-saved as .xlsx) — those end in a run of zeros.
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { error: "Not a valid number" };
    const digits = BigInt(Math.round(raw)).toString();
    if (digits.length >= 10 && /0{6,}$/.test(digits)) {
      return { error: `Ends in 000000, so Excel has rounded it. ${EXCEL_TEXT_HINT}` };
    }
    return { value: digits };
  }

  let str = cleanText(raw);
  if (!str) return { value: "" };

  // Excel float export: 919876543210.0
  if (/^\d+\.0+$/.test(str)) str = str.replace(/\.0+$/, "");

  // Scientific notation such as 9.19876E+11. Excel keeps only ~6 significant
  // digits in this form, so the remaining digits are gone for good.
  const sci = str.replace(/\s/g, "").match(SCIENTIFIC_NOTATION);
  if (sci) {
    const significantDigits = (sci[1] + (sci[2] || "")).replace(/^0+/, "").length;
    const expanded = BigInt(Math.round(Number(str.replace(/\s/g, "")))).toString();
    if (significantDigits < expanded.length) {
      return { error: `Saved in scientific notation (${str}), so its last digits are lost. ${EXCEL_TEXT_HINT}` };
    }
    return { value: expanded };
  }

  // Several numbers in one cell ("98765 43210 / 91234 56789"). Thousands
  // separators ("919,876,543,210") produce short chunks and are left alone.
  const parts = str
    .split(/[,;\/|]|\s{2,}|\bor\b/i)
    .map((p) => p.trim())
    .filter((p) => p.replace(/\D/g, "").length >= 7);
  if (parts.length > 1) {
    return { value: parts[0], warning: `Cell has ${parts.length} numbers; only the first was imported` };
  }

  return { value: str };
}

function describeInvalidPhone(value) {
  if (/[a-z]/i.test(value)) return "Contains letters, not a phone number";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8) return "Too short to be a phone number with country code";
  if (digits.length > 15) return "Too long; check for extra digits or two numbers in one cell";
  return "Not a valid phone number";
}

function readRawRows(buffer) {
  let rawRows = [];

  // 1. SheetJS raw matrix (.xlsx, .xls, .xlsb, .ods, .csv ...). raw: true keeps
  //    CSV text as text, so "9.19E+11" can be detected as corrupted.
  try {
    // sheetRows stops reading just past the limit, so huge sheets aren't fully
    // loaded only to be rejected.
    const workbook = XLSX.read(buffer, { type: "buffer", raw: true, cellDates: false, sheetRows: MAX_CONTACT_ROWS + 2 });
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

  // 2. Fallback: plain-text CSV with delimiter detection.
  if (rawRows.length === 0) {
    let content = buffer.toString("utf-8");
    if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
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

  return rawRows;
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

function detectColumns(rawRows) {
  const firstRow = (rawRows[0] || []).map((c) => String(c ?? ""));
  const headers = firstRow.map(cleanHeaderKey);
  const cols = { phone: -1, name: -1, firstName: -1, lastName: -1, countryCode: -1 };

  headers.forEach((h, idx) => {
    if (cols.phone === -1 && PHONE_HEADER_PATTERNS.includes(h)) cols.phone = idx;
    else if (cols.name === -1 && NAME_HEADER_PATTERNS.includes(h)) cols.name = idx;
    else if (cols.firstName === -1 && FIRST_NAME_PATTERNS.includes(h)) cols.firstName = idx;
    else if (cols.lastName === -1 && LAST_NAME_PATTERNS.includes(h)) cols.lastName = idx;
    else if (cols.countryCode === -1 && COUNTRY_CODE_PATTERNS.includes(h)) cols.countryCode = idx;
  });

  const hasHeaders = cols.phone !== -1 || cols.name !== -1 || cols.firstName !== -1 || cols.countryCode !== -1;

  // Headerless file, or headers without a recognisable phone column: pick the
  // column where most of the first rows look like phone numbers.
  if (cols.phone === -1) {
    const sample = rawRows.slice(hasHeaders ? 1 : 0, (hasHeaders ? 1 : 0) + 10);
    let best = -1;
    let bestCount = 0;
    for (let col = 0; col < firstRow.length; col++) {
      if (col === cols.name || col === cols.firstName || col === cols.lastName || col === cols.countryCode) continue;
      let count = 0;
      sample.forEach((r) => {
        const { value } = readPhoneCell(r[col]);
        if (value && validateAndFormatE164(value).isValid) count++;
      });
      if (count > bestCount) {
        bestCount = count;
        best = col;
      }
    }
    cols.phone = best;
    if (!hasHeaders && best !== -1 && firstRow.length > 1 && cols.name === -1) {
      cols.name = best === 0 ? 1 : 0;
    }
  }

  return { cols, hasHeaders };
}

function readName(row, cols) {
  if (cols.name !== -1 && cleanText(row[cols.name])) {
    return cleanText(row[cols.name]).slice(0, 120);
  }
  if (cols.firstName !== -1 || cols.lastName !== -1) {
    const fn = cols.firstName !== -1 ? cleanText(row[cols.firstName]) : "";
    const ln = cols.lastName !== -1 ? cleanText(row[cols.lastName]) : "";
    return `${fn} ${ln}`.trim().slice(0, 120);
  }
  return "";
}

/**
 * @returns {{ contacts: {phone, name, row}[], issues: {row, name, value, reason, type}[], totalRows: number, phoneColumnFound: boolean }}
 *   issue.type is "invalid", "duplicate" (repeated in this file) or "warning" (imported with a note).
 */
const parseContactsFile = async (buffer) => {
  const empty = { contacts: [], issues: [], totalRows: 0, phoneColumnFound: false };
  if (!buffer || buffer.length === 0) return empty;

  const rawRows = readRawRows(buffer);
  if (rawRows.length === 0) return empty;
  // +1 allows for a header row.
  if (rawRows.length > MAX_CONTACT_ROWS + 1) {
    throw new AppError(
      `This file has more than ${MAX_CONTACT_ROWS.toLocaleString("en-US")} rows. Split it into smaller files and import them one at a time.`,
      422,
      "too_many_rows"
    );
  }

  const { cols, hasHeaders } = detectColumns(rawRows);
  const dataRows = hasHeaders ? rawRows.slice(1) : rawRows;
  const firstDataRowNumber = hasHeaders ? 2 : 1;

  const contacts = [];
  const issues = [];
  const seen = new Map(); // phone -> row number
  let totalRows = 0;

  dataRows.forEach((row, index) => {
    if (!Array.isArray(row) || row.every((c) => cleanText(c) === "")) return;
    totalRows++;

    const rowNumber = firstDataRowNumber + index;
    const name = readName(row, cols);
    const rawCell = cols.phone !== -1 ? row[cols.phone] : undefined;
    const shown = cleanText(rawCell);

    const { value, error, warning } = readPhoneCell(rawCell);
    if (error) {
      issues.push({ row: rowNumber, name, value: shown, reason: error, type: "invalid" });
      return;
    }
    if (!value) {
      issues.push({ row: rowNumber, name, value: "", reason: "Phone number is missing", type: "invalid" });
      return;
    }

    const withCode = cols.countryCode !== -1 ? applyCountryCode(row[cols.countryCode], value) : value;
    const { isValid, formatted } = validateAndFormatE164(withCode);
    if (!isValid) {
      issues.push({ row: rowNumber, name, value: shown, reason: describeInvalidPhone(withCode), type: "invalid" });
      return;
    }

    if (seen.has(formatted)) {
      issues.push({
        row: rowNumber,
        name,
        value: formatted,
        reason: `Duplicate of row ${seen.get(formatted)} in this file`,
        type: "duplicate",
      });
      return;
    }
    seen.set(formatted, rowNumber);

    if (warning) {
      issues.push({ row: rowNumber, name, value: shown, reason: warning, type: "warning" });
    }
    contacts.push({ phone: formatted, name, row: rowNumber });
  });

  return { contacts, issues, totalRows, phoneColumnFound: cols.phone !== -1 };
};

// Backwards-compatible helper: just the valid contacts.
const parseCSV = async (buffer) => {
  const { contacts } = await parseContactsFile(buffer);
  return contacts.map((c) => ({ phone: c.phone, name: c.name || c.phone, label: "none" }));
};

module.exports = { parseContactsFile, parseCSV, readPhoneCell, MAX_CONTACT_FILE_MB, MAX_CONTACT_ROWS };
