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

  async delete(id) {
    const { data, error } = await supabase
      .from("templates")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  }
};

module.exports = templateRepository;
