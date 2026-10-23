const conversationRepository = require("../repositories/conversationRepository");
const messageRepository = require("../repositories/messageRepository");
const contactRepository = require("../repositories/contactRepository");
const whatsappService = require("./whatsappService");
const { resolveTemplateText, resolveTemplateSendTarget } = require("../utils/templateHelper");
const { validateAndFormatE164 } = require("../utils/phone");
const AppError = require("../errors/AppError");
const logger = require("../utils/logger");

const messageService = {
  async getConversations(query) {
    const { search } = query;
    const conversations = await conversationRepository.findAll();

    const enriched = (conversations || []).map((c) => {
      const contact = Array.isArray(c.contacts) ? c.contacts[0] : c.contacts;
      return {
        phone: c.phone,
        name: contact?.name || c.contact_name || c.phone,
        label: contact?.label || "none",
        isImportant: contact?.is_important || false,
        lastMessage: c.last_message,
        lastDirection: c.last_direction,
        lastStatus: c.last_status,
        lastTimestamp: c.last_timestamp,
        unreadCount: c.unread_count,
      };
    });

    let result = enriched;
    if (search) {
      result = enriched.filter(
        (c) =>
          c.name?.toLowerCase().includes(search.toLowerCase()) ||
          c.phone?.includes(search)
      );
    }
    return result;
  },

  async getMessages(phone, page = 1, limit = 50) {
    await conversationRepository.resetUnreadCount(phone);

    const { data, count } = await messageRepository.findByPhone(phone, page, limit);

    const mapped = (data || []).map((m) => ({
      _id: m.id,
      phone: m.phone,
      contactName: m.contact_name,
      text: m.text,
      type: m.type,
      direction: m.direction,
      status: m.status,
      messageId: m.message_id,
      errorDetails: m.error_details,
      mediaUrl: m.media_url || "",
      templateName: m.template_name || "",
      timestamp: m.timestamp,
    }));

    return {
      messages: mapped,
      total: count || 0,
    };
  },

  async getStats() {
    return await messageRepository.getStats();
  },

  async sendSingleMessage(body, io) {
    const { phone, message, type = "text", templateName, params = [], mediaUrl = "" } = body;

    if (!phone || (!message && !templateName)) {
      throw new AppError("Phone and message/template are required", 400, "validation_error");
    }

    const { isValid, formatted } = validateAndFormatE164(phone);
    if (!isValid) {
      throw new AppError(`Invalid phone number format: '${phone}'. Must follow E.164 standard.`, 400, "invalid_phone");
    }

    const contact = await contactRepository.findByPhone(formatted);
    const contactName = contact?.name && contact.name !== formatted ? contact.name : "Valued Customer";

    // Personalize message text with contact placeholders
    let personalizedMessage = message || "";
    if (personalizedMessage) {
      personalizedMessage = personalizedMessage
        .replace(/\{\{(name|contact_name|customer_name|recipient_name|1)\}\}/gi, contactName)
        .replace(/\{\{(phone|contact_phone|mobile|number)\}\}/gi, formatted);
    }

    // Personalize template params
    let personalizedParams = [];
    if (params && Array.isArray(params)) {
      personalizedParams = params.map((p) => {
        if (typeof p === "string") {
          const cleanP = p.trim().toLowerCase();
          if (!cleanP || cleanP === "{{contact_name}}" || cleanP === "{{name}}" || cleanP === "{{1}}" || cleanP === "{{customer_name}}") {
            return contactName;
          }
          if (cleanP === "{{contact_phone}}" || cleanP === "{{phone}}") {
            return formatted;
          }
        }
        return p || contactName;
      });
    }

    try {
      const provider = await whatsappService.getActiveProvider();
      const { sendName: apiTemplateName, language } = await resolveTemplateSendTarget(templateName, provider);
      const sendOptions = { language };

      let result;
      let displayText = personalizedMessage;

      if (type === "template") {
        if (provider === "meta" && (!apiTemplateName || String(apiTemplateName).startsWith("HX"))) {
          throw new AppError(
            `Invalid Meta template configuration for "${templateName}". Use an approved Meta template name.`,
            400,
            "validation_error"
          );
        }

        displayText = await resolveTemplateText(templateName, personalizedParams, message || "");
        result = personalizedParams.length > 0
          ? await whatsappService.sendTemplateWithParams(
              formatted,
              apiTemplateName,
              personalizedParams,
              mediaUrl,
              displayText,
              sendOptions
            )
          : await whatsappService.sendTemplateMessage(
              formatted,
              apiTemplateName,
              mediaUrl,
              displayText,
              sendOptions
            );
      } else {
        result = await whatsappService.sendTextMessage(formatted, personalizedMessage, mediaUrl);
      }

      const messageSid = result?.messages?.[0]?.id || result?.sid || "";

      const savedMsg = await messageRepository.create({
        phone: formatted,
        contact_name: contactName,
        text: displayText || personalizedMessage || `[Template: ${templateName}]`,
        type,
        direction: "outgoing",
        status: "sent",
        message_id: messageSid,
        template_name: templateName || "",
        timestamp: new Date().toISOString(),
      });

      await conversationRepository.upsert({
        phone: formatted,
        contact_name: contactName,
        last_message: savedMsg.text,
        last_direction: "outgoing",
        last_status: "sent",
        last_timestamp: savedMsg.timestamp,
      });

      if (io) {
        io.emit("new_message", {
          _id: savedMsg.id,
          phone: savedMsg.phone,
          contactName: savedMsg.contact_name,
          text: savedMsg.text,
          type: savedMsg.type,
          direction: savedMsg.direction,
          status: savedMsg.status,
          messageId: savedMsg.message_id,
          timestamp: savedMsg.timestamp,
        });
      }

      return savedMsg;
    } catch (err) {
      const errorMsg = err.message || String(err);
      const errorCategory = err.category || "other";

      try {
        const failText = personalizedMessage || `[Template: ${templateName}]`;
        const failTime = new Date().toISOString();

        const savedMsg = await messageRepository.create({
          phone: formatted,
          contact_name: contactName,
          text: failText,
          type,
          direction: "outgoing",
          status: "failed",
          template_name: templateName || "",
          error_details: errorMsg,
          error_category: errorCategory,
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

        if (io) {
          io.emit("new_message", {
            _id: savedMsg?.id,
            phone: formatted,
            contactName: contactName,
            text: failText,
            type: type,
            direction: "outgoing",
            status: "failed",
            messageId: "",
            timestamp: failTime,
          });
        }
      } catch (saveErr) {
        logger.error("Failed to save outbound failure message log:", { error: saveErr });
      }

      throw new AppError(errorMsg, 500, errorCategory);
    }
  }
};

module.exports = messageService;
