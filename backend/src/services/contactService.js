const contactRepository = require("../repositories/contactRepository");
const { parseCSV } = require("../utils/csvParser");
const AppError = require("../errors/AppError");

const contactService = {
  async uploadContacts(fileBuffer, targetSet) {
    const parsedContacts = await parseCSV(fileBuffer);

    if (parsedContacts.length === 0) {
      throw new AppError("No valid contacts found in spreadsheet file", 400, "validation_error");
    }

    const existingPhones = await contactRepository.getAllPhoneNumbers();
    const dbPhoneSet = new Set(existingPhones || []);

    let added = 0;
    let duplicates = 0;
    let skipped = 0;
    const fileSeenPhones = new Set();

    const cleanTargetSet = targetSet && targetSet !== "all" && targetSet !== "none"
      ? targetSet.trim().toLowerCase().replace(/\s+/g, "_")
      : null;

    for (const contact of parsedContacts) {
      try {
        const phone = contact.phone;
        const assignedLabel = cleanTargetSet || contact.label || "none";

        if (dbPhoneSet.has(phone) || fileSeenPhones.has(phone)) {
          duplicates++;
        } else {
          added++;
          fileSeenPhones.add(phone);
          dbPhoneSet.add(phone);
        }

        await contactRepository.upsert(phone, contact.name, assignedLabel);
      } catch (err) {
        skipped++;
      }
    }

    return {
      message: "Upload complete",
      added,
      duplicates,
      skipped,
      total: parsedContacts.length,
      targetSet: cleanTargetSet || "none",
    };
  },

  async createSingleContact({ name, phone, set, label }) {
    const { validateAndFormatE164 } = require("../utils/phone");
    const { isValid, formatted } = validateAndFormatE164(phone);

    if (!isValid) {
      throw new AppError("Invalid phone number format", 400, "validation_error");
    }

    const cleanSet = set && set !== "all" && set !== "none"
      ? set.trim().toLowerCase().replace(/\s+/g, "_")
      : label || "none";

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
