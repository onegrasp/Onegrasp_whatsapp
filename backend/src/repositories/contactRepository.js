const supabase = require("../config/supabase");

const contactRepository = {
  async upsert(phone, name, label = "none") {
    const payload = { phone, name, deleted_at: null };
    if (label && label !== "none") {
      payload.label = label;
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
      query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
    }

    if (set && set !== "all") {
      const cleanSet = set.trim().toLowerCase().replace(/\s+/g, "_");
      query = query.or(`label.eq.${cleanSet},label.eq.${set},tags.cs.{${cleanSet}},tags.cs.{${set}}`);
    } else if (label && label !== "all") {
      query = query.eq("label", label);
    }

    const { data, count, error } = await query
      .order("created_at", { ascending: false })
      .range(fromOffset, toLimit);

    if (error) throw error;
    return { data, count };
  },

  async getContactSets() {
    const { data, error } = await supabase
      .from("contacts")
      .select("label, tags")
      .is("deleted_at", null);

    if (error) throw error;

    const setCounts = {
      all: 0,
      test_contacts: 0,
      new_contacts: 0,
    };

    (data || []).forEach((c) => {
      setCounts.all++;
      if (c.label && c.label !== "none") {
        setCounts[c.label] = (setCounts[c.label] || 0) + 1;
      }
      if (c.tags && Array.isArray(c.tags)) {
        c.tags.forEach((tag) => {
          if (tag) setCounts[tag] = (setCounts[tag] || 0) + 1;
        });
      }
    });

    return setCounts;
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
    const { data, error } = await supabase
      .from("contacts")
      .select("phone, name, is_active")
      .in("phone", phones)
      .is("deleted_at", null);
    if (error) throw error;
    return data;
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
