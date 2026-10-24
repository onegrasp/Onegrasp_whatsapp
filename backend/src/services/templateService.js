const templateRepository = require("../repositories/templateRepository");
const { getTwilioClient } = require("../integrations/twilio/client");
const logger = require("../utils/logger");
const AppError = require("../errors/AppError");
const { getIo } = require("../socket");

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

// WhatsApp template button rules. Twilio's call-to-action type only takes
// link and call buttons, and its quick-reply type only takes replies, so the
// two kinds can't be mixed in one template.
const validateButtons = (buttons = []) => {
  const list = Array.isArray(buttons) ? buttons : [];
  const links = list.filter((b) => b.type === "URL").length;
  const calls = list.filter((b) => b.type === "phone").length;
  const replies = list.length - links - calls;
  if (replies > 0 && links + calls > 0) {
    throw new AppError(
      "A template can have quick-reply buttons or link/call buttons, but not both. Remove the Reply button, or remove the link and call buttons.",
      400,
      "validation_error"
    );
  }
  if (links > 2) throw new AppError("A template can have at most 2 link buttons.", 400, "validation_error");
  if (calls > 1) throw new AppError("A template can have only 1 call button.", 400, "validation_error");
  if (replies > 3) throw new AppError("A template can have at most 3 quick-reply buttons.", 400, "validation_error");
};

// Does this template have an image header? Only those can be sent with an image.
const templateHasImage = (tpl) => Boolean(tpl && (tpl.type === "media" || tpl.header_image_url));

const templateService = {
  async createTemplate(templateData) {
    const { name, body, type = "text", category = "UTILITY", language = "en", buttons = [], headerImageUrl } = templateData;
    validateButtons(buttons);

    const existing = await templateRepository.findByName(name);
    if (existing) {
      throw new AppError(`A template named "${name}" already exists. Choose a different name.`, 400, "duplicate_template");
    }
    // A deleted template may still hold this name in the database.
    await templateRepository.releaseDeletedName(name);

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
    try {
      const templates = await templateRepository.findAll();
      return { success: true, data: templates || [] };
    } catch (e) {
      logger.error("Failed to load templates from database:", { error: e.message });
      return { success: true, data: [] };
    }
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

    if (updateData.buttons) validateButtons(updateData.buttons);

    if (updateData.name && updateData.name !== template.name) {
      if (await templateRepository.nameTakenByOther(updateData.name, id)) {
        throw new AppError(`A template named "${updateData.name}" already exists. Choose a different name.`, 400, "duplicate_template");
      }
      await templateRepository.releaseDeletedName(updateData.name);
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
    // Catch drafts saved before the button rules existed.
    validateButtons(template.buttons);

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
      // Media header + body + buttons must use `whatsapp/card`, which carries a
      // real `body` (up to 1024 chars), an optional `footer`, a `media` header
      // (array of URLs), and `actions`. The old `twilio/card` has only a short
      // title/subtitle and NO body, so the full message text was silently
      // dropped and recipients received just the template name.
      const cardType = {
        body: template.body,
        actions: actions,
      };
      if (template.header_image_url) {
        cardType.media = [template.header_image_url];
      }
      types["whatsapp/card"] = cardType;
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
      // Never fall back to a stand-in picture: recipients would receive it.
      if (!template.header_image_url) {
        throw new AppError("Add an image to this media template before submitting it.", 400, "validation_error");
      }
      types["twilio/media"] = {
        body: template.body,
        media: [template.header_image_url],
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
    let status = null;
    let reason = "";

    try {
      const approval = await client.content.v1
        .contents(template.content_sid)
        .approvalFetch.get()
        .fetch();

      status = approval.status || approval.whatsapp?.status || null;
      reason = approval.rejectionReason || approval.whatsapp?.rejection_reason || "";
    } catch (err) {
      // Never overwrite a known status (e.g. "approved") because Twilio
      // couldn't be reached.
      logger.warn(`Failed to fetch approval status for SID ${template.content_sid}:`, { error: err });
      throw new AppError("Couldn't reach Twilio to check this template's status. Try again in a minute.", 502, "provider_unavailable");
    }

    if (!status) {
      return { status: template.status, rejectionReason: template.rejection_reason || "", _id: template.id, changed: false };
    }

    const changed = status !== template.status;
    const updated = await templateRepository.update(id, {
      status: status,
      rejection_reason: reason,
      updated_at: new Date().toISOString(),
    });

    if (changed) {
      logger.info(`Template "${template.name}" approval status changed: ${template.status} -> ${status}`);
      const io = getIo();
      if (io) io.emit("template_update", { id: updated.id, name: updated.name, status: updated.status });
    }

    return {
      status: updated.status,
      rejectionReason: updated.rejection_reason,
      _id: updated.id,
      changed,
    };
  },

  // Re-checks every template still waiting for WhatsApp's decision. Meta's
  // approval email often arrives before Twilio reflects it, so this runs on a
  // timer instead of relying on someone clicking "Check status".
  async syncAwaitingTemplates() {
    const waiting = await templateRepository.findAwaitingApproval();
    const changed = [];
    for (const template of waiting) {
      try {
        const result = await this.syncTemplateStatus(template.id);
        if (result.changed) changed.push({ name: template.name, status: result.status });
      } catch (err) {
        logger.warn(`Automatic status check failed for template "${template.name}"`, { error: err.message });
      }
    }
    return { checked: waiting.length, changed };
  },

  /**
   * Can this template be sent as a campaign right now? A template still marked
   * pending is re-checked live first, so a fresh approval isn't missed.
   * Unknown names are allowed through (Twilio has the final say).
   */
  async checkSendable(templateNameOrSid, { mediaUrl = "" } = {}) {
    if (!templateNameOrSid) return { ok: true };
    let tpl = await templateRepository.findByName(templateNameOrSid);
    if (!tpl) tpl = await templateRepository.findByContentSid(templateNameOrSid);
    if (!tpl) tpl = await templateRepository.findById(templateNameOrSid).catch(() => null);

    // WhatsApp delivers a template exactly as approved: an image can't be added
    // to a template that has no image header (Twilio rejects it, error 63021).
    if (tpl && mediaUrl && !templateHasImage(tpl)) {
      return {
        ok: false,
        status: tpl.status,
        template: tpl,
        message: `Template "${tpl.name}" has no image, so an image can't be sent with it. Remove the image, or use a template created with Type: Media (image).`,
      };
    }

    if (!tpl || tpl.status === "approved") return { ok: true, template: tpl };

    let status = tpl.status;
    let reason = tpl.rejection_reason || "";
    if (tpl.content_sid && (status === "pending" || status === "received" || !status)) {
      try {
        const fresh = await this.syncTemplateStatus(tpl.id);
        status = fresh.status;
        reason = fresh.rejectionReason || reason;
      } catch (e) {
        // Keep the stored status if Twilio can't be reached.
      }
      if (status === "approved") return { ok: true, template: { ...tpl, status } };
    }

    let message;
    if (!tpl.content_sid || !status || status === "draft" || status === "unsubmitted") {
      message = `Template "${tpl.name}" hasn't been submitted for WhatsApp approval yet. Submit it on the Templates page first.`;
    } else if (status === "pending" || status === "received") {
      message = `Template "${tpl.name}" is still waiting for WhatsApp approval. If Meta's approval email has arrived, it can take a few minutes to show here — the app re-checks automatically every 10 minutes, or click Check status.`;
    } else if (status === "rejected") {
      message = `Template "${tpl.name}" was rejected by WhatsApp${reason ? `: ${reason}` : ""}. Edit and resubmit it on the Templates page.`;
    } else {
      message = `Template "${tpl.name}" can't be sent right now (WhatsApp status: ${status}).`;
    }
    return { ok: false, status, message, template: tpl };
  },

  async syncAllTemplates() {
    const client = await getTwilioClient();

    logger.info("Syncing all templates from Twilio Content API...");
    const twilioTemplates = await client.content.v1.contentAndApprovals.list({ limit: 100 });

    let createdCount = 0;
    let updatedCount = 0;
    const skipped = [];

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
      } else if (typesObj["whatsapp/card"] || typesObj["twilio/card"]) {
        parsedType = typesObj["whatsapp/card"] || typesObj["twilio/card"];
        type = "interactive";
      } else {
        const keys = Object.keys(typesObj);
        if (keys.length > 0) {
          parsedType = typesObj[keys[0]];
          type = keys[0].includes("text") ? "text" : "interactive";
        }
      }

      // Templates with an image header (media or card types) keep that image,
      // so Bulk send knows an image may be sent with them.
      let headerImageUrl = "";
      if (parsedType && Array.isArray(parsedType.media) && parsedType.media.length > 0) {
        headerImageUrl = parsedType.media[0];
        type = "media";
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

      // One bad template must not stop the rest from syncing.
      try {
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
            ...(headerImageUrl ? { header_image_url: headerImageUrl } : {}),
            updated_at: new Date().toISOString(),
          };
          // Take Twilio's name unless another template here already uses it.
          if (templateName && templateName !== existing.name) {
            await templateRepository.releaseDeletedName(templateName);
            if (!(await templateRepository.nameTakenByOther(templateName, existing.id))) {
              updatePayload.name = templateName;
            }
          }
          await templateRepository.update(existing.id, updatePayload);
          updatedCount++;
        } else {
          const nameExisting = templateName ? await templateRepository.findByName(templateName) : null;
          // Same name, but already linked to a different Twilio template (e.g. an
          // older submission): keep both instead of overwriting the link.
          const linkedElsewhere = Boolean(nameExisting && nameExisting.content_sid && nameExisting.content_sid !== t.sid);
          if (nameExisting && !linkedElsewhere) {
            await templateRepository.update(nameExisting.id, {
              content_sid: t.sid,
              body,
              type,
              language: t.language || "en",
              status,
              rejection_reason: rejectionReason,
              buttons,
              variables,
              ...(headerImageUrl ? { header_image_url: headerImageUrl } : {}),
              updated_at: new Date().toISOString(),
            });
            updatedCount++;
          } else {
            const safeName = !templateName ? t.sid : linkedElsewhere ? `${templateName}_${t.sid.slice(-6)}` : templateName;
            await templateRepository.releaseDeletedName(safeName);
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
              ...(headerImageUrl ? { header_image_url: headerImageUrl } : {}),
              version: 1,
            });
            createdCount++;
          }
        }
      } catch (err) {
        logger.warn(`Skipped template "${templateName || t.sid}" during sync`, { error: err.message });
        skipped.push(templateName || t.sid);
      }
    }

    logger.info(`Synced ${twilioTemplates.length} templates from Twilio Content API. Created: ${createdCount}, Updated: ${updatedCount}, Skipped: ${skipped.length}`);
    return {
      message: skipped.length
        ? `Synced ${twilioTemplates.length - skipped.length} of ${twilioTemplates.length} templates from Twilio. Couldn't sync: ${skipped.join(", ")}.`
        : `Successfully synced ${twilioTemplates.length} templates from Twilio.`,
      created: createdCount,
      updated: updatedCount,
      skipped,
      total: twilioTemplates.length,
    };
  },
};

module.exports = templateService;
module.exports.validateButtons = validateButtons;
module.exports.templateHasImage = templateHasImage;
