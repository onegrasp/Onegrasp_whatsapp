const messagingService = require("../integrations/twilio/messaging.service");
const contentService = require("../integrations/twilio/content.service");
const logger = require("../utils/logger");

const { normalizePhone } = require("../utils/phone");

const twilioService = {
  formatToTwilioPhone(phone) {
    const normalized = normalizePhone(phone);
    return `whatsapp:${normalized}`;
  },

  async sendTemplateMessage(to, templateName, mediaUrl = null) {
    const res = await messagingService.sendTemplate(to, templateName, [], mediaUrl);
    return {
      messages: [{ id: res.sid }]
    };
  },

  async sendTemplateWithParams(to, templateName, params = [], mediaUrl = null) {
    const res = await messagingService.sendTemplate(to, templateName, params, mediaUrl);
    return {
      messages: [{ id: res.sid }]
    };
  },

  async sendTextMessage(to, text, mediaUrl = null) {
    const res = await messagingService.sendText(to, text, mediaUrl);
    return {
      messages: [{ id: res.sid }]
    };
  },

  async markAsRead(messageId) {
    return messagingService.markAsRead(messageId);
  },

  async getTemplates() {
    try {
      const list = await contentService.fetchTemplatesList();
      return {
        data: list.map((t) => ({
          id: t.sid,
          name: t.friendlyName,
          types: t.types,
        }))
      };
    } catch (error) {
      logger.error("Error fetching approved Twilio templates:", { error });
      return { data: [] };
    }
  }
};

module.exports = twilioService;
