const contactRepository = require("../repositories/contactRepository");
const { parseContactsFile } = require("../utils/csvParser");
const { validateAndFormatE164, applyCountryCode } = require("../utils/phone");
const AppError = require("../errors/AppError");

const MAX_REPORTED_ISSUES = 200;

const cleanSetName = (set) =>
  set && set !== "all" && set !== "none" ? set.trim().toLowerCase().replace(/\s+/g, "_") : null;

// Names that were auto-filled rather than entered, so a real name from an
// upload may replace them.
const isPlaceholderName = (name, phone) =>
  !name || name === phone || ["unknown", "customer", "valued customer"].includes(String(name).trim().toLowerCase());

const contactService = {
  async uploadContacts(fileBuffer, targetSet) {
    const { contacts: parsed, issues, totalRows, phoneColumnFound } = await parseContactsFile(fileBuffer);

    if (totalRows === 0) {
      throw new AppError("The file has no rows to import.", 400, "validation_error");
    }
    if (!phoneColumnFound) {
      throw new AppError("Could not find a phone number column. Add a header named Phone (and optionally Name and Country Code).", 400, "validation_error");
    }

    const cleanTargetSet = cleanSetName(targetSet);

    // Numbers already saved are not duplicated or overwritten. They are
    // reported, and added to the chosen set if there is one.
    const existingRows = await contactRepository.findActiveByPhones(parsed.map((c) => c.phone));
    const existingByPhone = new Map(existingRows.map((c) => [c.phone, c]));

    const toInsert = [];
    const alreadySaved = [];
    for (const c of parsed) {
      const existing = existingByPhone.get(c.phone);
      if (existing) alreadySaved.push({ ...c, existing });
      else toInsert.push(c);
    }

    const failedInserts = await contactRepository.insertMany(
      toInsert.map((c) => ({
        phone: c.phone,
        name: c.name || c.phone,
        label: cleanTargetSet || "none",
        tags: cleanTargetSet ? [cleanTargetSet] : [],
        deleted_at: null,
        updated_at: new Date().toISOString(),
      }))
    );
    const failedPhones = new Set(failedInserts.map((f) => f.phone));

    if (cleanTargetSet && alreadySaved.length > 0) {
      await contactRepository.assignSet(alreadySaved.map((c) => c.existing.id), cleanTargetSet);
    }
    for (const c of alreadySaved) {
      if (c.name && isPlaceholderName(c.existing.name, c.phone)) {
        await contactRepository.updateName(c.existing.id, c.name).catch(() => {});
      }
    }

    const allIssues = [
      ...issues,
      ...alreadySaved.map((c) => ({
        row: c.row,
        name: c.name,
        value: c.phone,
        reason: cleanTargetSet
          ? `Already saved as "${c.existing.name}"; added to this set`
          : `Already saved as "${c.existing.name}"`,
        type: "existing",
      })),
      ...toInsert
        .filter((c) => failedPhones.has(c.phone))
        .map((c) => ({
          row: c.row,
          name: c.name,
          value: c.phone,
          reason: `Could not be saved: ${failedInserts.find((f) => f.phone === c.phone).message}`,
          type: "invalid",
        })),
    ].sort((a, b) => a.row - b.row);

    const count = (type) => allIssues.filter((i) => i.type === type).length;
    const duplicatesInFile = count("duplicate");

    return {
      message: "Upload complete",
      total: totalRows,
      added: toInsert.length - failedPhones.size,
      existing: alreadySaved.length,
      duplicatesInFile,
      invalid: count("invalid"),
      warnings: count("warning"),
      // Kept for older clients: everything that was not newly added because the number was already known.
      duplicates: duplicatesInFile + alreadySaved.length,
      skipped: count("invalid") + duplicatesInFile,
      targetSet: cleanTargetSet || "none",
      issues: allIssues.slice(0, MAX_REPORTED_ISSUES),
      issuesTotal: allIssues.length,
    };
  },

  async createSingleContact({ name, phone, countryCode, set, label }) {
    const composed = countryCode ? applyCountryCode(countryCode, phone) : phone;
    const { isValid, formatted } = validateAndFormatE164(composed);

    if (!isValid) {
      throw new AppError("Enter a valid phone number, including the country code.", 400, "validation_error");
    }

    const existing = await contactRepository.findByPhone(formatted);
    if (existing) {
      throw new AppError(`${formatted} is already saved as "${existing.name}".`, 409, "duplicate_contact");
    }

    const cleanSet = cleanSetName(set) || label || "none";
    const contactName = (name || "").trim() || formatted;

    const contact = await contactRepository.upsert(formatted, contactName, cleanSet);
    return {
      success: true,
      contact: {
        _id: contact.id,
        name: contact.name,
        phone: contact.phone,
        label: contact.label,
      },
    };
  },

  async deleteBulkContacts(ids) {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      throw new AppError("No contact IDs provided for deletion", 400, "validation_error");
    }
    const count = await contactRepository.deleteBulk(ids);
    return {
      success: true,
      message: `Deleted ${count} contacts`,
      deletedCount: count,
    };
  },

  async getContacts(query) {
    const { search, label, set, page = 1, limit = 50 } = query;
    const { data, count } = await contactRepository.findAll({ search, label, set, page, limit });

    const mapped = (data || []).map((c) => ({
      _id: c.id,
      name: c.name,
      phone: c.phone,
      label: c.label,
      tags: c.tags,
      isActive: c.is_active,
      isImportant: c.is_important,
      createdAt: c.created_at,
    }));

    return {
      contacts: mapped,
      total: count || 0,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    };
  },

  async getContactSets() {
    const sets = await contactRepository.getContactSets();
    return {
      success: true,
      sets,
    };
  },

  async assignSet(contactIds, setName) {
    const updated = await contactRepository.assignSet(contactIds, setName);
    return {
      message: `Assigned ${updated.length} contacts to set '${setName}'`,
      updatedCount: updated.length,
    };
  },

  async removeSet(contactIds, setName) {
    const updated = await contactRepository.removeSet(contactIds, setName);
    return {
      message: `Removed ${updated.length} contacts from set '${setName}'`,
      updatedCount: updated.length,
    };
  },

  async updateContactLabel(id, label) {
    const contact = await contactRepository.updateLabel(id, label);
    return {
      _id: contact.id,
      name: contact.name,
      phone: contact.phone,
      label: contact.label,
    };
  },

  async deleteContact(id) {
    await contactRepository.delete(id);
    return { message: "Contact deleted" };
  },

  async exportContacts() {
    const contacts = await contactRepository.exportAll();
    return (contacts || []).map((c) => ({
      _id: c.id,
      name: c.name,
      phone: c.phone,
      label: c.label,
      tags: c.tags,
      isActive: c.is_active,
      isImportant: c.is_important,
      createdAt: c.created_at,
    }));
  },

  async toggleImportantContact(phone, isImportant) {
    const contact = await contactRepository.toggleImportant(phone, isImportant);
    return {
      _id: contact.id,
      name: contact.name,
      phone: contact.phone,
      isImportant: contact.is_important,
    };
  }
};

module.exports = contactService;
