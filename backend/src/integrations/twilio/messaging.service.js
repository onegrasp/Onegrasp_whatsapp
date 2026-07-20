const { getTwilioConfig, getTwilioClient } = require("./client");
const { mapTwilioError } = require("./errors");
const { runWithRetry } = require("./retry");
const logger = require("../../utils/logger");

const formatToTwilioPhone = (phone) => {
  const clean = phone.trim().replace(/^whatsapp:/i, "");
  if (clean.startsWith("+")) {
    return `whatsapp:${clean}`;
  }
  return `whatsapp:+${clean}`;
};

const getStatusCallback = () => {
  const url = process.env.STATUS_CALLBACK_URL;
  if (!url) return undefined;

  if (url.includes("localhost") || url.includes("127.0.0.1")) {
    return undefined;
  }
  return url;
};

const messagingService = {
  async sendText(to, text, mediaUrl = null) {
    const config = await getTwilioConfig();
    const client = await getTwilioClient();

    const options = {
      to: formatToTwilioPhone(to),
    };

    if (config.mode === "production" && config.messagingServiceSid) {
      options.messagingServiceSid = config.messagingServiceSid;
    } else {
      options.from = config.fromPhone;
    }

    if (text) {
      options.body = text;
    }
    if (mediaUrl) {
      options.mediaUrl = [mediaUrl];
    }

    const callbackUrl = getStatusCallback();
    if (callbackUrl) {
      options.statusCallback = callbackUrl;
    }

    try {
      const message = await runWithRetry(() => client.messages.create(options));
      return { sid: message.sid };
    } catch (err) {
      const errorDetails = mapTwilioError(err);
      const customErr = new Error(errorDetails.message);
      customErr.code = errorDetails.code;
      customErr.category = errorDetails.category;
      throw customErr;
    }
  },

  async sendTemplate(to, templateName, params = [], mediaUrl = null) {
    const config = await getTwilioConfig();
    const client = await getTwilioClient();

    const options = {
      to: formatToTwilioPhone(to),
    };

    if (config.mode === "production" && config.messagingServiceSid) {
      options.messagingServiceSid = config.messagingServiceSid;
    } else {
      options.from = config.fromPhone;
    }

    if (templateName.startsWith("HX")) {
      options.contentSid = templateName;
      if (params.length > 0) {
        const variables = {};
        params.forEach((p, index) => {
          variables[String(index + 1)] = p;
        });
        options.contentVariables = JSON.stringify(variables);
      }
      if (mediaUrl) {
        options.mediaUrl = [mediaUrl];
      }
    } else {
      let body = templateName;
      params.forEach((p, index) => {
        body = body.replace(new RegExp(`\\{\\{${index + 1}\\}\\}`, "g"), p);
      });
      options.body = body;
      if (mediaUrl) {
        options.mediaUrl = [mediaUrl];
      }
    }

    const callbackUrl = getStatusCallback();
    if (callbackUrl) {
      options.statusCallback = callbackUrl;
    }

    try {
      const message = await runWithRetry(() => client.messages.create(options));
      return { sid: message.sid };
    } catch (err) {
      const errorDetails = mapTwilioError(err);
      const customErr = new Error(errorDetails.message);
      customErr.code = errorDetails.code;
      customErr.category = errorDetails.category;
      throw customErr;
    }
  },

  async markAsRead(messageId) {
    const client = await getTwilioClient();
    if (!messageId || !messageId.startsWith("SM")) {
      return { success: false, message: "Invalid message ID for Twilio read-receipt" };
    }
    try {
      const response = await client.messages(messageId).update({ status: "read" });
      return { success: true, sid: response.sid };
    } catch (err) {
      logger.error("Error marking message as read in Twilio:", { messageId, error: err });
      return { success: false, error: err.message };
    }
  }
};

module.exports = messagingService;
