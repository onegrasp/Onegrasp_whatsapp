const supabase = require("../config/supabase");
const logger = require("../utils/logger");

// Strip characters that are significant in PostgREST filter grammar so raw user
// input (search terms, set names) cannot inject extra filter conditions into an
// `.or()` / `.ilike()` expression.
const sanitizeFilterValue = (value) =>
  String(value == null ? "" : value).replace(/[,()*:"\\{}]/g, " ").trim();

// Columns added by migrations/005_sending_safeguards.sql. Until it runs,
// writes that include them fail, so they are dropped and the write retried —
// the core change (opt-out, new contact) must never be lost.
const OPTIONAL_COLUMNS = ["consent_status", "consent_source", "consent_at", "invalid_reason", "invalid_at"];
let optionalColumnsMissing = false;

const isMissingColumnError = (error) =>
  Boolean(error) &&
  (error.code === "PGRST204" || error.code === "42703" || /column|schema cache/i.test(error.message || "")) &&
  OPTIONAL_COLUMNS.some((c) => (error.message || "").includes(c));

const stripOptional = (payload) => {
  if (Array.isArray(payload)) return payload.map(stripOptional);
  const copy = { ...payload };
  OPTIONAL_COLUMNS.forEach((c) => delete copy[c]);
  return copy;
};

const hasOptional = (payload) =>
  (Array.isArray(payload) ? payload : [payload]).some((p) => OPTIONAL_COLUMNS.some((c) => c in p));

// Runs `write(payload)` (a Supabase query builder), retrying without the
// optional columns if the database doesn't have them yet.
async function writeContacts(write, payload) {
  const first = optionalColumnsMissing ? stripOptional(payload) : payload;
  let { data, error } = await write(first);
  if (error && hasOptional(first) && isMissingColumnError(error)) {
    optionalColumnsMissing = true;
    logger.warn("Contact consent columns are missing — run backend/migrations/005_sending_safeguards.sql.");
    ({ data, error } = await write(stripOptional(first)));
  }
  if (error) throw error;
  return data;
}

const phoneVariants = (phone) => {
  const clean = String(phone || "").replace(/^\+/, "");
  return Array.from(new Set([phone, clean, `+${clean}`]));
};

const contactRepository = {
  optionalColumnsMissing: () => optionalColumnsMissing,
  async upsert(phone, name, label = "none") {
    const cleanLabel = label && label !== "all" ? label.trim().toLowerCase().replace(/\s+/g, "_") : "none";
    
    // Fetch existing contact to merge tags if present
    const { data: existing } = await supabase
      .from("contacts")
      .select("id, label, tags")
      .eq("phone", phone)
      .is("deleted_at", null)
      .maybeSingle();

    const payload = {
      phone,
      name,
      deleted_at: null,
      updated_at: new Date().toISOString(),
    };

    if (cleanLabel !== "none") {
      payload.label = cleanLabel;
      const existingTags = Array.isArray(existing?.tags) ? existing.tags : [];
      if (!existingTags.includes(cleanLabel)) {
        payload.tags = [...existingTags, cleanLabel];
      } else {
        payload.tags = existingTags;
      }
    }

    const { data, error } = await supabase
      .from("contacts")
      .upsert(payload, { onConflict: "phone" })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async findAll({ search, label, set, page = 1, limit = 50 }) {
    const fromOffset = (parseInt(page) - 1) * parseInt(limit);
    const toLimit = fromOffset + parseInt(limit) - 1;

    let query = supabase
      .from("contacts")
      .select("*", { count: "exact" })
      .is("deleted_at", null);

    if (search) {
      const s = sanitizeFilterValue(search);
      if (s) query = query.or(`name.ilike.%${s}%,phone.ilike.%${s}%`);
    }

    if (set && set !== "all") {
      const cleanSet = sanitizeFilterValue(set).toLowerCase().replace(/\s+/g, "_");
      if (cleanSet) query = query.or(`label.eq.${cleanSet},tags.cs.{${cleanSet}}`);
    } else if (label && label !== "all") {
      query = query.eq("label", sanitizeFilterValue(label));
    }

    try {
      const { data, count, error } = await query
        .order("created_at", { ascending: false })
        .range(fromOffset, toLimit);

      if (error) {
        return { data: [], count: 0 };
      }
      return { data: data || [], count: count || 0 };
    } catch (err) {
      return { data: [], count: 0 };
    }
  },

  async getContactSets() {
    const setCounts = {
      all: 0,
      test_contacts: 0,
      new_contacts: 0,
    };

    try {
      const { data, error } = await supabase
        .from("contacts")
        .select("label, tags")
        .is("deleted_at", null);

      if (error || !data) return setCounts;

      (data || []).forEach((c) => {
        setCounts.all++;
        const contactSets = new Set();

        if (c.label && c.label !== "none") {
          contactSets.add(c.label);
        }
        if (c.tags && Array.isArray(c.tags)) {
          c.tags.forEach((tag) => {
            if (tag) contactSets.add(tag);
          });
        }

        contactSets.forEach((setName) => {
          setCounts[setName] = (setCounts[setName] || 0) + 1;
        });
      });

      return setCounts;
    } catch (err) {
      return setCounts;
    }
  },

  async assignSet(contactIds, setName) {
    if (!contactIds || contactIds.length === 0 || !setName) return [];
    const cleanSet = setName.trim().toLowerCase().replace(/\s+/g, "_");

    // Fetch contacts to update their tags and label
    const { data: contacts, error: fetchErr } = await supabase
      .from("contacts")
      .select("id, label, tags")
      .in("id", contactIds);

    if (fetchErr) throw fetchErr;

    const updatedList = [];
    for (const c of (contacts || [])) {
      const existingTags = Array.isArray(c.tags) ? c.tags : [];
      if (!existingTags.includes(cleanSet)) {
        existingTags.push(cleanSet);
      }
      const { data: updated } = await supabase
        .from("contacts")
        .update({
          label: cleanSet,
          tags: existingTags,
          updated_at: new Date().toISOString(),
        })
        .eq("id", c.id)
        .select()
        .single();
      if (updated) updatedList.push(updated);
    }

    return updatedList;
  },

  async removeSet(contactIds, setName) {
    if (!contactIds || contactIds.length === 0 || !setName) return [];
    const cleanSet = setName.trim().toLowerCase().replace(/\s+/g, "_");

    const { data: contacts, error: fetchErr } = await supabase
      .from("contacts")
      .select("id, label, tags")
      .in("id", contactIds);

    if (fetchErr) throw fetchErr;

    const updatedList = [];
    for (const c of (contacts || [])) {
      const existingTags = Array.isArray(c.tags) ? c.tags.filter(t => t !== cleanSet) : [];
      const newLabel = c.label === cleanSet ? "none" : c.label;
      const { data: updated } = await supabase
        .from("contacts")
        .update({
          label: newLabel,
          tags: existingTags,
          updated_at: new Date().toISOString(),
        })
        .eq("id", c.id)
        .select()
        .single();
      if (updated) updatedList.push(updated);
    }

    return updatedList;
  },

  async findById(id) {
    const { data, error } = await supabase
      .from("contacts")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async findByPhone(phone) {
    const { data, error } = await supabase
      .from("contacts")
      .select("*")
      .eq("phone", phone)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async updateLabel(id, label) {
    const { data, error } = await supabase
      .from("contacts")
      .update({ label })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { data, error } = await supabase
      .from("contacts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async exportAll() {
    const { data, error } = await supabase
      .from("contacts")
      .select("*")
      .is("deleted_at", null);
    if (error) throw error;
    return data;
  },

  async toggleImportant(phone, isImportant) {
    const { data: existing } = await supabase
      .from("contacts")
      .select("name")
      .eq("phone", phone)
      .maybeSingle();

    let query;
    if (existing) {
      query = supabase
        .from("contacts")
        .update({ is_important: isImportant })
        .eq("phone", phone);
    } else {
      query = supabase
        .from("contacts")
        .insert({
          phone,
          name: phone,
          is_important: isImportant,
        });
    }

    const { data, error } = await query.select().single();
    if (error) throw error;
    return data;
  },

  async getContactsByPhones(phones) {
    const rawPhones = Array.from(new Set(phones.flatMap(p => [p, p.replace(/^\+/, ""), `+${p.replace(/^\+/, "")}`])));
    const { data, error } = await supabase
      .from("contacts")
      .select("phone, name, is_active")
      .in("phone", rawPhones)
      .is("deleted_at", null);
    if (error) throw error;
    return data;
  },

  async deactivateByPhone(phone) {
    return this.setOptOut(phone, { reason: "provider_opt_out", source: "provider_error" });
  },

  // Records an opt-out: the number goes on the opt_outs list (enforced for
  // every send) and the contact is deactivated with the reason kept.
  async setOptOut(phone, { reason = "user_opt_out", source = "" } = {}) {
    const { error: optError } = await supabase
      .from("opt_outs")
      .upsert({ phone, reason, opted_out_at: new Date().toISOString() }, { onConflict: "phone" });
    if (optError) logger.warn("Could not write opt_outs row", { phone, error: optError.message });

    return writeContacts(
      (payload) => supabase.from("contacts").update(payload).in("phone", phoneVariants(phone)).select("id"),
      {
        is_active: false,
        consent_status: "opted_out",
        consent_source: source || reason,
        consent_at: new Date().toISOString(),
      }
    );
  },

  // Reverses an opt-out after the person asks to subscribe again.
  async clearOptOut(phone, { source = "" } = {}) {
    const { error: optError } = await supabase.from("opt_outs").delete().in("phone", phoneVariants(phone));
    if (optError) logger.warn("Could not remove opt_outs row", { phone, error: optError.message });

    return writeContacts(
      (payload) => supabase.from("contacts").update(payload).in("phone", phoneVariants(phone)).select("id"),
      { is_active: true, consent_status: "opted_in", consent_source: source, consent_at: new Date().toISOString() }
    );
  },

  // Records consent for several contacts. Opting someone out also adds them
  // to the opt_outs list; opting in removes them from it.
  async updateConsent(ids, status, source = "") {
    if (!ids || ids.length === 0) return [];
    const { data: rows, error } = await supabase.from("contacts").select("id, phone").in("id", ids);
    if (error) throw error;

    for (const row of rows || []) {
      if (status === "opted_out") await this.setOptOut(row.phone, { reason: "admin", source });
      else await this.clearOptOut(row.phone, { source });
    }
    return rows || [];
  },

  // WhatsApp said this number can't receive messages. Kept on the contact so
  // campaigns can leave it out; cleared when a message reaches it again.
  async markInvalid(phone, reason) {
    return writeContacts(
      (payload) => supabase.from("contacts").update(payload).in("phone", phoneVariants(phone)).select("id"),
      { invalid_reason: String(reason || "Not reachable on WhatsApp").slice(0, 300), invalid_at: new Date().toISOString() }
    ).catch((e) => logger.warn("Could not flag invalid number", { phone, error: e.message }));
  },

  async clearInvalid(phone) {
    if (optionalColumnsMissing) return;
    const { error } = await supabase
      .from("contacts")
      .update({ invalid_reason: "", invalid_at: null })
      .in("phone", phoneVariants(phone))
      .not("invalid_at", "is", null);
    if (error && isMissingColumnError(error)) optionalColumnsMissing = true;
  },

  // Full contact rows for many phones (chunked to stay under URL and row limits).
  async findDetailedByPhones(phones) {
    const unique = Array.from(new Set(phones || []));
    const rows = [];
    for (let i = 0; i < unique.length; i += 300) {
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .in("phone", unique.slice(i, i + 300))
        .is("deleted_at", null);
      if (error) throw error;
      rows.push(...(data || []));
    }
    return rows;
  },

  async findOptedOutPhones(phones) {
    const unique = Array.from(new Set((phones || []).flatMap(phoneVariants)));
    const result = new Set();
    for (let i = 0; i < unique.length; i += 300) {
      const { data, error } = await supabase.from("opt_outs").select("phone").in("phone", unique.slice(i, i + 300));
      if (error) {
        logger.warn("Could not read opt_outs", { error: error.message });
        break;
      }
      (data || []).forEach((r) => result.add(`+${String(r.phone).replace(/^\+/, "")}`));
    }
    return result;
  },

  async isOptedOut(phone) {
    try {
      const variants = phoneVariants(phone);
      const { data } = await supabase
        .from("opt_outs")
        .select("id")
        .in("phone", variants)
        .limit(1);
      return Array.isArray(data) && data.length > 0;
    } catch (e) {
      return false;
    }
  },

  async reactivateAllNonOptOutContacts() {
    try {
      const { data: optOuts } = await supabase.from("opt_outs").select("phone");
      const optOutPhones = (optOuts || []).map(o => o.phone).filter(Boolean);

      let query = supabase.from("contacts").update({ is_active: true }).eq("is_active", false);
      if (optOutPhones.length > 0) {
        query = query.not("phone", "in", `(${optOutPhones.join(",")})`);
      }
      await query;
    } catch (e) {
      // Fallback: simple reset if opt_outs table query fails
      await supabase.from("contacts").update({ is_active: true }).eq("is_active", false);
    }
  },

  async deleteBulk(ids) {
    if (!ids || ids.length === 0) return 0;
    const { error } = await supabase
      .from("contacts")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", ids);
    if (error) throw error;
    return ids.length;
  },

  // Active (not deleted) contacts for the given phones, queried in chunks so
  // large uploads don't exceed URL length limits.
  async findActiveByPhones(phones) {
    const unique = Array.from(new Set(phones || []));
    const rows = [];
    for (let i = 0; i < unique.length; i += 300) {
      const { data, error } = await supabase
        .from("contacts")
        .select("id, phone, name, label, tags")
        .in("phone", unique.slice(i, i + 300))
        .is("deleted_at", null);
      if (error) throw error;
      rows.push(...(data || []));
    }
    return rows;
  },

  // Inserts new contacts in batches. Upserting on phone also restores rows
  // that were soft-deleted earlier. Returns the phones that could not be saved.
  async insertMany(contacts) {
    const failed = [];
    const upsert = (payload) => supabase.from("contacts").upsert(payload, { onConflict: "phone" });
    for (let i = 0; i < contacts.length; i += 500) {
      const chunk = contacts.slice(i, i + 500);
      try {
        await writeContacts(upsert, chunk);
        continue;
      } catch (chunkError) {
        // Isolate the rows that fail.
      }
      for (const row of chunk) {
        try {
          await writeContacts(upsert, row);
        } catch (rowError) {
          failed.push({ phone: row.phone, message: rowError.message });
        }
      }
    }
    return failed;
  },

  // Records consent for existing contacts found in an upload.
  async recordConsentByIds(ids, source) {
    if (!ids || ids.length === 0) return;
    await writeContacts(
      (payload) => supabase.from("contacts").update(payload).in("id", ids).neq("consent_status", "opted_out"),
      { consent_status: "opted_in", consent_source: source, consent_at: new Date().toISOString() }
    ).catch((e) => logger.warn("Could not record consent for existing contacts", { error: e.message }));
  },

  async updateName(id, name) {
    const { error } = await supabase.from("contacts").update({ name }).eq("id", id);
    if (error) throw error;
  },

  async getAllPhoneNumbers() {
    const { data, error } = await supabase
      .from("contacts")
      .select("phone")
      .is("deleted_at", null);
    if (error) throw error;
    return (data || []).map((c) => c.phone);
  }
};

module.exports = contactRepository;
