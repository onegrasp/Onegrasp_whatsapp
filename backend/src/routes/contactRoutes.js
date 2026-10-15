const express = require("express");
const router = express.Router();
const multer = require("multer");
const { parseCSV } = require("../utils/csvParser");
const supabase = require("../utils/supabase");
const logger = require("../utils/logger");

const upload = multer({ storage: multer.memoryStorage() });

// Upload CSV and save contacts in Supabase
router.post("/contacts/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const contacts = await parseCSV(req.file.buffer);

    if (contacts.length === 0) {
      return res.status(400).json({ error: "No valid contacts found in CSV" });
    }

    let added = 0;
    let skipped = 0;

    for (const contact of contacts) {
      try {
        const { error } = await supabase
          .from("contacts")
          .upsert({
            phone: contact.phone,
            name: contact.name,
          }, { onConflict: "phone" });

        if (error) throw error;
        added++;
      } catch (err) {
        logger.error(`Failed to upload contact ${contact.phone}:`, { error: err });
        skipped++;
      }
    }

    res.json({
      message: "Upload complete",
      added,
      skipped,
      total: contacts.length,
    });
  } catch (err) {
    logger.error("Upload error:", { error: err });
    res.status(500).json({ error: "Failed to process CSV" });
  }
});

// Get all contacts with filters
router.get("/contacts", async (req, res) => {
  try {
    const { search, label, page = 1, limit = 50 } = req.query;
    const fromOffset = (parseInt(page) - 1) * parseInt(limit);
    const toLimit = fromOffset + parseInt(limit) - 1;

    let query = supabase.from("contacts").select("*", { count: "exact" });

    if (search) {
      query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
    }

    if (label && label !== "all") {
      query = query.eq("label", label);
    }

    const { data: contacts, count: total, error } = await query
      .order("created_at", { ascending: false })
      .range(fromOffset, toLimit);

    if (error) throw error;

    // Map properties for React frontend compatibility (like id -> _id, is_active -> isActive)
    const mapped = (contacts || []).map((c) => ({
      _id: c.id,
      name: c.name,
      phone: c.phone,
      label: c.label,
      tags: c.tags,
      isActive: c.is_active,
      isImportant: c.is_important,
      createdAt: c.created_at,
    }));

    res.json({ contacts: mapped, total: total || 0, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    logger.error("Failed to load contacts from Supabase:", { error: err });
    res.status(500).json({ error: "Failed to fetch contacts" });
  }
});

// Update contact label
router.patch("/contacts/:id/label", async (req, res) => {
  try {
    const { label } = req.body;
    
    const { data: contact, error } = await supabase
      .from("contacts")
      .update({ label })
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      _id: contact.id,
      name: contact.name,
      phone: contact.phone,
      label: contact.label,
    });
  } catch (err) {
    logger.error("Failed to update contact label in Supabase:", { error: err });
    res.status(500).json({ error: "Failed to update label" });
  }
});

// Delete contact
router.delete("/contacts/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("contacts")
      .delete()
      .eq("id", req.params.id);

    if (error) throw error;

    res.json({ message: "Contact deleted" });
  } catch (err) {
    logger.error("Failed to delete contact in Supabase:", { error: err });
    res.status(500).json({ error: "Failed to delete contact" });
  }
});

// Export contacts
router.get("/contacts/export", async (req, res) => {
  try {
    const { data: contacts, error } = await supabase
      .from("contacts")
      .select("*");

    if (error) throw error;

    const mapped = (contacts || []).map((c) => ({
      _id: c.id,
      name: c.name,
      phone: c.phone,
      label: c.label,
      tags: c.tags,
      isActive: c.is_active,
      isImportant: c.is_important,
      createdAt: c.created_at,
    }));

    res.json(mapped);
  } catch (err) {
    logger.error("Failed to export contacts from Supabase:", { error: err });
    res.status(500).json({ error: "Failed to export contacts" });
  }
});

// Toggle contact important status by phone number
router.patch("/contacts/important/:phone", async (req, res) => {
  try {
    const { phone } = req.params;
    const { isImportant } = req.body;

    // First try updating
    const { data: existingContact } = await supabase
      .from("contacts")
      .select("name")
      .eq("phone", phone)
      .maybeSingle();

    let contact;
    let error;

    if (existingContact) {
      const res = await supabase
        .from("contacts")
        .update({ is_important: isImportant })
        .eq("phone", phone)
        .select()
        .single();
      contact = res.data;
      error = res.error;
    } else {
      const res = await supabase
        .from("contacts")
        .insert({
          phone,
          name: phone, // Default name is phone since they don't exist yet
          is_important: isImportant,
        })
        .select()
        .single();
      contact = res.data;
      error = res.error;
    }

    if (error) throw error;

    res.json({
      _id: contact.id,
      name: contact.name,
      phone: contact.phone,
      isImportant: contact.is_important,
    });
  } catch (err) {
    logger.error("Failed to toggle contact importance in Supabase:", { error: err });
    res.status(500).json({ error: "Failed to update contact status" });
  }
});

module.exports = router;
