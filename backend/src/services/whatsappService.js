const metaMessagingService = require("../integrations/meta/messaging.service");
const { getMetaConfig } = require("../integrations/meta/client");
const twilioService = require("./twilioService");
const { getTwilioConfig, clearTwilioConfigCache } = require("../config/twilio");
const logger = require("../utils/logger");

const whatsappService = {
  async getActiveProvider() {
    const metaConfig = await getMetaConfig();
    if (metaConfig.isConfigured) {
      return "meta";
    }
    const twilioConfig = await getTwilioConfig();
    if (twilioConfig.accountSid && twilioConfig.accountSid.startsWith("AC")) {
      return "twilio";
    }
    return "simulation";
  },

  async sendTemplateMessage(to, templateName, mediaUrl = null, fallbackMessage = null, options = {}) {
    const provider = await this.getActiveProvider();
    logger.info(`Sending template message using active provider: '${provider}' to ${to} (template: ${templateName})`);

    if (provider === "meta") {
      const params = options.params || [];
      const res = await metaMessagingService.sendTemplate(to, templateName, params, mediaUrl, options);
      return {
        messages: [{ id: res.sid }],
        provider: "meta",
      };
    }

    return twilioService.sendTemplateMessage(to, templateName, mediaUrl, fallbackMessage);
  },

  async sendTemplateWithParams(to, templateName, params = [], mediaUrl = null, fallbackMessage = null, options = {}) {
    const provider = await this.getActiveProvider();
    logger.info(`Sending template with params using active provider: '${provider}' to ${to} (template: ${templateName})`);

    if (provider === "meta") {
      const res = await metaMessagingService.sendTemplate(to, templateName, params, mediaUrl, options);
      return {
        messages: [{ id: res.sid }],
        provider: "meta",
      };
    }

    return twilioService.sendTemplateWithParams(to, templateName, params, mediaUrl, fallbackMessage);
  },

  async sendTextMessage(to, text, mediaUrl = null) {
    const provider = await this.getActiveProvider();
    logger.info(`Sending text message using active provider: '${provider}' to ${to}`);

    if (provider === "meta") {
      const res = await metaMessagingService.sendText(to, text, mediaUrl);
      return {
        messages: [{ id: res.sid }],
        provider: "meta",
      };
    }

    return twilioService.sendTextMessage(to, text, mediaUrl);
  },

  async markAsRead(messageId) {
    const provider = await this.getActiveProvider();
    if (provider === "meta") {
      return metaMessagingService.markAsRead(messageId);
    }
    return twilioService.markAsRead(messageId);
  },

  getTwilioConfig,
  clearTwilioConfigCache,
  getMetaConfig,
};

module.exports = whatsappService;
