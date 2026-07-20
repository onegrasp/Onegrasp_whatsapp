const templateRepository = require("../repositories/templateRepository");
const { getTwilioClient } = require("../integrations/twilio/client");
const logger = require("../utils/logger");
const AppError = require("../errors/AppError");

function extractVariables(text) {
  if (!text) return [];
  const regex = /\{\{(\d+|\w+)\}\}/g;
  const matches = new Set();
  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.add(match[1]);
  }
  return Array.from(matches);
}

function getSampleValue(varName) {
  const name = varName.toLowerCase();
  if (name.includes("name")) return "John";
  if (name.includes("percent") || name.includes("discount") || name.includes("rate")) return "10";
  if (name.includes("code") || name.includes("promo")) return "WELCOME10";
  if (name.includes("number") || name.includes("id")) return "12345";
  if (name.includes("date")) return "2026-07-17";
  if (name.includes("time")) return "12:00 PM";
  if (name.includes("url") || name.includes("link")) return "https://onegrasp.com";
  return varName;
}

const templateService = {
  async createTemplate(templateData) {
    const { name, body, type = "text", category = "UTILITY", language = "en", buttons = [], headerImageUrl } = templateData;

    const existing = await templateRepository.findByName(name);
    if (existing) {
      throw new AppError(`Template with name '${name}' already exists.`, 400, "duplicate_template");
    }

    const variables = extractVariables(body);

    const created = await templateRepository.create({
      name,
      body,
      type,
      category,
      language,
      buttons,
      variables,
      header_image_url: headerImageUrl || "",
      status: "draft",
      version: 1,
    });

    return created;
  },

  async getTemplates() {
    const templates = await templateRepository.findAll();
    return {
      success: true,
      data: templates,
    };
  },

  async getTemplateById(id) {
    const template = await templateRepository.findById(id);
    if (!template) {
      throw new AppError("Template not found", 404, "template_not_found");
    }
    return template;
  },

  async updateTemplate(id, updateData) {
    const template = await templateRepository.findById(id);
    if (!template) {
      throw new AppError("Template not found", 404, "template_not_found");
    }

    if (updateData.body) {
      updateData.variables = extractVariables(updateData.body);
    }

    const { headerImageUrl, ...restData } = updateData;
    const payload = { ...restData };
    if (headerImageUrl !== undefined) {
      payload.header_image_url = headerImageUrl;
    }

    const updated = await templateRepository.update(id, {
      ...payload,
      updated_at: new Date().toISOString(),
    });

    return updated;
  },

  async deleteTemplate(id) {
    const template = await templateRepository.findById(id);
    if (!template) {
      throw new AppError("Template not found", 404, "template_not_found");
    }

    if (template.content_sid) {
      try {
        const client = await getTwilioClient();
        await client.content.v1.contents(template.content_sid).remove();
        logger.info(`Deleted Content SID ${template.content_sid} from Twilio.`);
      } catch (err) {
        logger.warn(`Failed to delete Content SID ${template.content_sid} from Twilio:`, { error: err });
      }
    }

    await templateRepository.delete(id);
    return { message: "Template deleted successfully" };
  },

  async submitTemplate(id) {
    const template = await templateRepository.findById(id);
    if (!template) {
      throw new AppError("Template not found", 404, "template_not_found");
    }

    const client = await getTwilioClient();

    const variablesMap = {};
    if (template.variables && Array.isArray(template.variables)) {
      template.variables.forEach((v) => {
        variablesMap[v] = getSampleValue(v);
      });
    }

    const types = {};
    if (template.type === "media" && template.buttons && template.buttons.length > 0) {
      const actions = template.buttons.map((b) => {
        if (b.type === "URL") {
          return { type: "URL", title: b.text, url: b.url };
        } else if (b.type === "phone") {
          return { type: "PHONE_NUMBER", title: b.text, phone: b.phone };
        } else {
          return { type: "QUICK_REPLY", title: b.text, id: b.text };
        }
      });
      types["twilio/card"] = {
        title: "Welcome to OneGrasp",
        body: template.body,
        media: [template.header_image_url || "https://wcnfmuxtygwejrhlqqvu.supabase.co/storage/v1/object/public/whatsapp-media/welcome-media__1784288927046.jpg"],
        actions: actions,
      };
    } else if (template.buttons && template.buttons.length > 0) {
      const actions = template.buttons.map((b) => {
        if (b.type === "URL") {
          return { type: "URL", title: b.text, url: b.url };
        } else if (b.type === "phone") {
          return { type: "PHONE_NUMBER", title: b.text, phone: b.phone };
        } else {
          return { type: "QUICK_REPLY", title: b.text, id: b.text };
        }
      });

      const hasUrlOrPhone = template.buttons.some((b) => b.type === "URL" || b.type === "phone");
      if (hasUrlOrPhone) {
        types["twilio/call-to-action"] = {
          body: template.body,
          actions: actions,
        };
      } else {
        types["twilio/quick-reply"] = {
          body: template.body,
          actions: actions,
        };
      }
    } else if (template.type === "media") {
      types["twilio/media"] = {
        body: template.body,
        media: [template.header_image_url || "https://wcnfmuxtygwejrhlqqvu.supabase.co/storage/v1/object/public/whatsapp-media/1784287979883-test_image.png"]
      };
    } else {
      types["twilio/text"] = {
        body: template.body,
      };
    }

    logger.info(`Creating content resource in Twilio Content Builder API for '${template.name}'...`);
    const content = await client.content.v1.contents.create({
      friendlyName: template.name,
      language: template.language || "en",
      variables: variablesMap,
      types: types,
    });

    logger.info(`Twilio Content SID generated: ${content.sid}. Requesting Meta approval...`);

    let approvalStatus = "pending";
    let rejectionReason = "";
    try {
      const approval = await client.content.v1
        .contents(content.sid)
        .approvalCreate.create({
          name: template.name.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
          category: template.category || "UTILITY",
        });

      approvalStatus = approval.status || approval.whatsapp?.status || "pending";
      rejectionReason = approval.rejectionReason || approval.whatsapp?.rejection_reason || "";
    } catch (approvalErr) {
      logger.warn(`Approval request submit warning for SID ${content.sid}:`, { error: approvalErr });
    }

    const updated = await templateRepository.update(id, {
      content_sid: content.sid,
      status: approvalStatus,
      rejection_reason: rejectionReason,
      updated_at: new Date().toISOString(),
    });

    return {
      message: "Template successfully submitted for Meta approval",
      _id: updated.id,
      contentSid: updated.content_sid,
      status: updated.status,
      rejectionReason: updated.rejection_reason,
    };
  },

  async syncTemplateStatus(id) {
    const template = await templateRepository.findById(id);
    if (!template) {
      throw new AppError("Template not found", 404, "template_not_found");
    }
    if (!template.content_sid) {
      throw new AppError("Template has not been submitted for approval yet", 400, "validation_error");
    }

    const client = await getTwilioClient();

    logger.info(`Fetching approval status for Content SID ${template.content_sid}...`);
    let status = "pending";
    let reason = "";

    try {
      const approval = await client.content.v1
        .contents(template.content_sid)
        .approvalFetch.get()
        .fetch();

      status = approval.status || approval.whatsapp?.status || "pending";
      reason = approval.rejectionReason || approval.whatsapp?.rejection_reason || "";
    } catch (err) {
      logger.warn(`Failed to fetch approval status for SID ${template.content_sid}:`, { error: err });
    }

    const updated = await templateRepository.update(id, {
      status: status,
      rejection_reason: reason,
      updated_at: new Date().toISOString(),
    });

    return {
      status: updated.status,
      rejectionReason: updated.rejection_reason,
      _id: updated.id,
    };
  },

  async syncAllTemplates() {
    const client = await getTwilioClient();

    logger.info("Syncing all templates from Twilio Content API...");
    const twilioTemplates = await client.content.v1.contentAndApprovals.list({ limit: 100 });

    let createdCount = 0;
    let updatedCount = 0;

    for (const t of (twilioTemplates || [])) {
      const approvalReq = t.approvalRequests || {};
      const status = approvalReq.status || "draft";
      const rejectionReason = approvalReq.rejection_reason || "";

      let body = "";
      let type = "text";
      let buttons = [];
      const typesObj = t.types || {};

      let parsedType = null;
      if (typesObj["twilio/text"]) {
        parsedType = typesObj["twilio/text"];
        type = "text";
      } else if (typesObj["twilio/media"]) {
        parsedType = typesObj["twilio/media"];
        type = "media";
      } else if (typesObj["twilio/call-to-action"]) {
        parsedType = typesObj["twilio/call-to-action"];
        type = "interactive";
      } else if (typesObj["twilio/quick-reply"]) {
        parsedType = typesObj["twilio/quick-reply"];
        type = "interactive";
      } else if (typesObj["twilio/list-picker"]) {
        parsedType = typesObj["twilio/list-picker"];
        type = "interactive";
      } else {
        const keys = Object.keys(typesObj);
        if (keys.length > 0) {
          parsedType = typesObj[keys[0]];
          type = keys[0].includes("text") ? "text" : "interactive";
        }
      }

      if (parsedType) {
        body = parsedType.body || "";
        if (parsedType.actions && Array.isArray(parsedType.actions)) {
          buttons = parsedType.actions.map((a) => ({
            text: a.title || a.id || "Click",
            type: a.type === "URL" ? "URL" : a.type === "PHONE_NUMBER" ? "phone" : "reply",
            url: a.url || "",
            phone: a.phone || "",
          }));
        }
      }

      const variables = extractVariables(body);
      const templateName = t.friendlyName || null;

      const existing = await templateRepository.findByContentSid(t.sid);
      if (existing) {
        const updatePayload = {
          body,
          type,
          language: t.language || "en",
          status,
          rejection_reason: rejectionReason,
          buttons,
          variables,
          updated_at: new Date().toISOString(),
        };
        // Only overwrite name if Twilio actually has a friendlyName
        if (templateName) {
          updatePayload.name = templateName;
        }
        await templateRepository.update(existing.id, updatePayload);
        updatedCount++;
      } else {
        const safeName = templateName || t.sid;
        const nameExisting = templateName ? await templateRepository.findByName(templateName) : null;
        if (nameExisting) {
          await templateRepository.update(nameExisting.id, {
            content_sid: t.sid,
            body,
            type,
            language: t.language || "en",
            status,
            rejection_reason: rejectionReason,
            buttons,
            variables,
            updated_at: new Date().toISOString(),
          });
          updatedCount++;
        } else {
          await templateRepository.create({
            name: safeName,
            content_sid: t.sid,
            body,
            type,
            category: "UTILITY",
            language: t.language || "en",
            status,
            rejection_reason: rejectionReason,
            buttons,
            variables,
            version: 1,
          });
          createdCount++;
        }
      }
    }

    logger.info(`Synced ${twilioTemplates.length} templates from Twilio Content API. Created: ${createdCount}, Updated: ${updatedCount}`);
    return {
      message: `Successfully synced ${twilioTemplates.length} templates from Twilio.`,
      created: createdCount,
      updated: updatedCount,
      total: twilioTemplates.length,
    };
  },
};

module.exports = templateService;
