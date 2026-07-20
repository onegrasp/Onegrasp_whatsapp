const campaignRepository = require("../repositories/campaignRepository");
const contactRepository = require("../repositories/contactRepository");
const jobRepository = require("../repositories/jobRepository");
const messageRepository = require("../repositories/messageRepository");
const conversationRepository = require("../repositories/conversationRepository");
const { validateAndFormatE164 } = require("../utils/phone");
const logger = require("../utils/logger");
const AppError = require("../errors/AppError");

const campaignService = {
  async sendBulk(body, io) {
    const { phones, templateName, message, campaignName, type = "template", params = [], mediaUrl = "", scheduledAt = null } = body;

    if (!phones || phones.length === 0) {
      throw new AppError("No phone numbers provided", 400, "validation_error");
    }

    if (type === "template" && !templateName) {
      throw new AppError("Template name/content is required", 400, "validation_error");
    }

    let resolvedContentSidOrName = templateName || "";
    if (type === "template" && templateName) {
      try {
        const templateRepository = require("../repositories/templateRepository");
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(templateName);
        let foundTpl = null;
        if (isUuid) {
          foundTpl = await templateRepository.findById(templateName);
        } else {
          foundTpl = await templateRepository.findByName(templateName);
          if (!foundTpl) {
            foundTpl = await templateRepository.findByContentSid(templateName);
          }
        }
        if (foundTpl && foundTpl.content_sid) {
          resolvedContentSidOrName = foundTpl.content_sid;
        }
      } catch (e) {
        logger.warn("Could not resolve template Content SID, using provided templateName:", { error: e });
      }
    }

    if (type === "text" && !message) {
      throw new AppError("Message text is required", 400, "validation_error");
    }

    let sanitizedMessage = message || "";
    if (type === "text" && message) {
      sanitizedMessage = message.replace(/\0/g, "");
      if (sanitizedMessage.length > 4096) {
        sanitizedMessage = sanitizedMessage.substring(0, 4096);
      }
    }

    const campaign = await campaignRepository.create({
      name: campaignName || `Campaign ${new Date().toLocaleDateString()}`,
      message: sanitizedMessage || "",
      template_name: templateName || "",
      type,
      total_contacts: phones.length,
      status: scheduledAt && new Date(scheduledAt) > new Date() ? "scheduled" : "running",
    });

    logger.info(`Starting campaign: ${campaign.name} (${campaign.id}) for ${phones.length} contacts.`);

    const cleanDbPhones = phones.map(p => {
      const { formatted } = validateAndFormatE164(p);
      return formatted;
    }).filter(Boolean);

    const contactMap = {};
    if (cleanDbPhones.length > 0) {
      try {
        const contactsList = await contactRepository.getContactsByPhones(cleanDbPhones);
        (contactsList || []).forEach((c) => {
          if (c.phone) {
            contactMap[c.phone] = c;
          }
        });
      } catch (dbErr) {
        logger.error("Failed to query contact names for bulk sending variable resolution:", { error: dbErr });
      }
    }

    let immediateFailures = 0;
    const jobsToInsert = [];

    for (const rawPhone of phones) {
      const { isValid, formatted } = validateAndFormatE164(rawPhone);

      if (!isValid) {
        immediateFailures++;
        logger.warn(`Phone number validation failed during bulk import: ${rawPhone}`);

        const failText = message || `[Template: ${templateName}]`;
        const failTime = new Date().toISOString();

        await messageRepository.create({
          phone: rawPhone,
          text: failText,
          type: type === "template" ? "template" : "text",
          direction: "outgoing",
          status: "failed",
          error_details: "Invalid phone number format. Must be E.164 (e.g., +1234567890).",
          error_category: "invalid_phone",
          campaign_id: campaign.id,
          timestamp: failTime,
        });

        await conversationRepository.upsert({
          phone: rawPhone,
          contact_name: rawPhone,
          last_message: failText,
          last_direction: "outgoing",
          last_status: "failed",
          last_timestamp: failTime,
        });

        continue;
      }

      const contact = contactMap[formatted];
      const contactName = contact?.name || "Customer";

      if (contact && contact.is_active === false) {
        immediateFailures++;
        logger.warn(`Phone number campaign send skipped: contact is inactive/opted-out: ${formatted}`);

        const failText = message || `[Template: ${templateName}]`;
        const failTime = new Date().toISOString();

        await messageRepository.create({
          phone: formatted,
          text: failText,
          type: type === "template" ? "template" : "text",
          direction: "outgoing",
          status: "failed",
          error_details: "Contact has opted out or is inactive.",
          error_category: "opt_out",
          campaign_id: campaign.id,
          timestamp: failTime,
        });

        await conversationRepository.upsert({
          phone: formatted,
          contact_name: contactName,
          last_message: failText,
          last_direction: "outgoing",
          last_status: "failed",
          last_timestamp: failTime,
        });

        continue;
      }

      const resolvedParams = (params || []).map(p => {
        if (p === "{{contact_name}}") return contactName;
        if (p === "{{contact_phone}}") return formatted;
        return p;
      });

      const resolvedMsgText = type === "text" && sanitizedMessage
        ? sanitizedMessage.replace(/\{\{contact_name\}\}/g, contactName).replace(/\{\{contact_phone\}\}/g, formatted)
        : (sanitizedMessage || "");

      jobsToInsert.push({
        campaign_id: campaign.id,
        phone: formatted,
        type,
        template_name: resolvedContentSidOrName,
        message: resolvedMsgText,
        params: resolvedParams,
        media_url: mediaUrl,
        status: "pending",
        run_at: scheduledAt ? new Date(scheduledAt).toISOString() : new Date().toISOString(),
      });
    }

    if (jobsToInsert.length > 0) {
      await jobRepository.createBatch(jobsToInsert);
      logger.info(`Queued ${jobsToInsert.length} sending tasks inside campaign ${campaign.id}`);
    }

    if (immediateFailures === phones.length) {
      await campaignRepository.update(campaign.id, {
        status: "failed",
        failed_count: immediateFailures,
      });

      if (io) {
        io.emit("campaign_complete", {
          campaignId: campaign.id,
          sentCount: 0,
          failedCount: immediateFailures,
          total: phones.length,
        });
      }
    } else if (immediateFailures > 0) {
      await campaignRepository.update(campaign.id, {
        failed_count: immediateFailures,
      });
    }

    return {
      message: "Campaign queued successfully",
      campaignId: campaign.id,
      total: phones.length,
      queued: jobsToInsert.length,
      failed: immediateFailures,
    };
  },

  async getCampaigns() {
    const campaigns = await campaignRepository.findAll();
    return campaigns.map(c => ({
      _id: c.id,
      name: c.name,
      message: c.message,
      templateName: c.template_name,
      type: c.type,
      totalContacts: c.total_contacts,
      sentCount: c.sent_count,
      deliveredCount: c.delivered_count,
      readCount: c.read_count,
      failedCount: c.failed_count,
      status: c.status,
      createdAt: c.created_at,
    }));
  },

  async getCampaignMessages(campaignId) {
    const messages = await messageRepository.findByCampaignId(campaignId);
    return messages.map(m => ({
      _id: m.id,
      phone: m.phone,
      contactName: m.contact_name,
      text: m.text,
      type: m.type,
      direction: m.direction,
      status: m.status,
      messageId: m.message_id,
      errorDetails: m.error_details,
      timestamp: m.timestamp,
    }));
  }
};

module.exports = campaignService;
