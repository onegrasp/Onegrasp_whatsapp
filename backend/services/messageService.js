const conversationRepository = require("../repositories/conversationRepository");
const messageRepository = require("../repositories/messageRepository");
const contactRepository = require("../repositories/contactRepository");
const twilioService = require("./twilioService");
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

    try {
      let result;
      if (type === "template") {
        result = params.length > 0
          ? await twilioService.sendTemplateWithParams(formatted, templateName, params)
          : await twilioService.sendTemplateMessage(formatted, templateName);
      } else {
        result = await twilioService.sendTextMessage(formatted, message, mediaUrl);
      }

      const messageSid = result?.messages?.[0]?.id || "";
      const contact = await contactRepository.findByPhone(formatted);

      const savedMsg = await messageRepository.create({
        phone: formatted,
        contact_name: contact?.name || "",
        text: message || `[Template: ${templateName}]`,
        type,
        direction: "outgoing",
        status: "sent",
        message_id: messageSid,
        template_name: templateName || "",
        timestamp: new Date().toISOString(),
      });

      await conversationRepository.upsert({
        phone: formatted,
        contact_name: contact?.name || formatted,
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
        const contact = await contactRepository.findByPhone(formatted);
        const failText = message || `[Template: ${templateName}]`;
        const failTime = new Date().toISOString();

        const savedMsg = await messageRepository.create({
          phone: formatted,
          contact_name: contact?.name || "",
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
          contact_name: contact?.name || formatted,
          last_message: failText,
          last_direction: "outgoing",
          last_status: "failed",
          last_timestamp: failTime,
        });

        if (io) {
          io.emit("new_message", {
            _id: savedMsg?.id,
            phone: formatted,
            contactName: contact?.name || "",
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
