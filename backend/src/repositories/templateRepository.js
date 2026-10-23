const supabase = require("../config/supabase");

const templateRepository = {
  async findAll() {
    const { data, error } = await supabase
      .from("templates")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  },

  async findById(id) {
    const { data, error } = await supabase
      .from("templates")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async findByName(name) {
    const { data, error } = await supabase
      .from("templates")
      .select("*")
      .eq("name", name)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async findByContentSid(contentSid) {
    const { data, error } = await supabase
      .from("templates")
      .select("*")
      .eq("content_sid", contentSid)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  // Submitted templates still waiting for WhatsApp's decision.
  async findAwaitingApproval() {
    const { data, error } = await supabase
      .from("templates")
      .select("*")
      .in("status", ["pending", "received"])
      .neq("content_sid", "")
      .not("content_sid", "is", null)
      .is("deleted_at", null);
    if (error) throw error;
    return data || [];
  },

  async create(templateData) {
    const { data, error } = await supabase
      .from("templates")
      .insert([templateData])
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, templateData) {
    const { data, error } = await supabase
      .from("templates")
      .update(templateData)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async updateByContentSid(contentSid, templateData) {
    const { data, error } = await supabase
      .from("templates")
      .update(templateData)
      .eq("content_sid", contentSid)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async updateByName(name, templateData) {
    const { data, error } = await supabase
      .from("templates")
      .update(templateData)
      .eq("name", name)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  // Soft delete. The name is changed too, because `templates.name` is unique:
  // otherwise a deleted template keeps its name reserved and re-creating or
  // syncing a template with that name fails.
  async delete(id) {
    const { data: row } = await supabase.from("templates").select("id, name").eq("id", id).maybeSingle();
    const update = { deleted_at: new Date().toISOString() };
    if (row && row.name && !row.name.includes("__deleted_")) update.name = `${row.name}__deleted_${row.id.slice(0, 8)}`;

    const { data, error } = await supabase
      .from("templates")
      .update(update)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  // Frees a name still held by templates deleted before deletes renamed them.
  async releaseDeletedName(name) {
    if (!name) return;
    const { data: rows, error } = await supabase
      .from("templates")
      .select("id, name")
      .eq("name", name)
      .not("deleted_at", "is", null);
    if (error) throw error;
    for (const row of rows || []) {
      await supabase.from("templates").update({ name: `${row.name}__deleted_${row.id.slice(0, 8)}` }).eq("id", row.id);
    }
  },

  // Another active template already using this name (ignoring `exceptId`)?
  async nameTakenByOther(name, exceptId) {
    const { data, error } = await supabase
      .from("templates")
      .select("id")
      .eq("name", name)
      .is("deleted_at", null)
      .neq("id", exceptId)
      .limit(1);
    if (error) throw error;
    return Boolean(data && data.length);
  },
};

module.exports = templateRepository;
