const { getTwilioConfig, getTwilioClient } = require("./client");
const { mapTwilioError } = require("./errors");
const { runWithRetry } = require("./retry");
const logger = require("../../utils/logger");

const { normalizePhone } = require("../../utils/phone");

const formatToTwilioPhone = (phone) => {
  const normalized = normalizePhone(phone);
  return `whatsapp:${normalized}`;
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
    const { resolveTemplateText } = require("../../utils/templateHelper");

    const options = {
      to: formatToTwilioPhone(to),
    };

    if (config.mode === "production" && config.messagingServiceSid) {
      options.messagingServiceSid = config.messagingServiceSid;
    } else {
      options.from = config.fromPhone;
    }

    const hasMedia = mediaUrl && typeof mediaUrl === "string" && mediaUrl.trim() && mediaUrl.trim().startsWith("http");

    if (hasMedia) {
      // If an image media URL is attached, resolve full offer body text so WhatsApp renders the complete readable text caption below the image poster!
      const fullText = await resolveTemplateText(templateName, params, "Hello Valued Customer");
      options.body = fullText;
      options.mediaUrl = [mediaUrl.trim()];
    } else {
      let resolvedContentSid = null;

      if (typeof templateName === "string" && templateName.startsWith("HX")) {
        resolvedContentSid = templateName;
      } else if (templateName) {
        try {
          const templateRepo = require("../../repositories/templateRepository");
          let tpl = await templateRepo.findByName(templateName);
          if (!tpl) tpl = await templateRepo.findById(templateName);
          if (!tpl) tpl = await templateRepo.findByContentSid(templateName);

          if (tpl && tpl.content_sid && tpl.content_sid.startsWith("HX")) {
            resolvedContentSid = tpl.content_sid;
          } else {
            // Query Twilio Content API to auto-resolve approved template SID by friendlyName
            const list = await client.content.v1.contents.list({ limit: 100 });
            const match = (list || []).find((t) =>
              t.sid === templateName ||
              t.friendlyName === templateName ||
              t.friendlyName === (tpl?.name || "")
            );
            if (match && match.sid) {
              resolvedContentSid = match.sid;
              if (tpl) {
                await templateRepo.update(tpl.id, { content_sid: match.sid, status: "approved" }).catch(() => {});
              }
            }
          }
        } catch (err) {
          logger.warn("Could not lookup Content SID for templateName:", { templateName, error: err });
        }
      }

      if (!resolvedContentSid || resolvedContentSid === "HX85226ed4e3bdc24d4a82a70d97985864" || resolvedContentSid === "HXd4cf82f8979c8bd95001cf4cbc2c0fc4") {
        resolvedContentSid = "HX4afb936dcb321774240a30de0bea6efd";
      }

      if (resolvedContentSid) {
        options.contentSid = resolvedContentSid;

        // Dynamically fetch exact variable keys expected by Twilio Content SID
        let expectedKeys = [];
        try {
          const contentInfo = await client.content.v1.contents(resolvedContentSid).fetch();
          if (contentInfo && contentInfo.variables && typeof contentInfo.variables === "object") {
            expectedKeys = Object.keys(contentInfo.variables);
          }
        } catch (fetchErr) {
          // Fallback to template repository in DB if Twilio fetch fails
          try {
            const templateRepo = require("../../repositories/templateRepository");
            let tpl = await templateRepo.findByContentSid(resolvedContentSid);
            if (!tpl) tpl = await templateRepo.findByName(templateName);
            if (tpl && Array.isArray(tpl.variables)) {
              expectedKeys = tpl.variables;
            }
          } catch (e) {}
        }

        if (expectedKeys.length > 0) {
          const variablesMap = {};
          const paramArray = Array.isArray(params) ? params : (typeof params === "object" && params !== null ? Object.values(params) : []);
          expectedKeys.forEach((k, idx) => {
            const val = paramArray[idx] !== undefined ? String(paramArray[idx]) : (paramArray[0] !== undefined ? String(paramArray[0]) : "Valued Customer");
            variablesMap[k] = val;
          });
          options.contentVariables = JSON.stringify(variablesMap);
        }
      } else {
        const fullText = await resolveTemplateText(templateName, params, templateName);
        options.body = fullText;
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
      // If Content SID dispatch failed (e.g. template parameter mismatch or pending approval), attempt fallback to text/media body
      if (options.contentSid) {
        logger.warn(`Content SID ${options.contentSid} dispatch failed: ${err.message}. Retrying with template body fallback...`);
        try {
          const fallbackBody = await resolveTemplateText(templateName, params, "Hello Valued Customer");

          const fallbackOptions = {
            to: options.to,
            body: fallbackBody,
          };
          if (options.messagingServiceSid) {
            fallbackOptions.messagingServiceSid = options.messagingServiceSid;
          } else if (options.from) {
            fallbackOptions.from = options.from;
          }
          if (options.mediaUrl) {
            fallbackOptions.mediaUrl = options.mediaUrl;
          }
          if (callbackUrl) {
            fallbackOptions.statusCallback = callbackUrl;
          }

          const fallbackMessage = await runWithRetry(() => client.messages.create(fallbackOptions));
          return { sid: fallbackMessage.sid };
        } catch (fallbackErr) {
          logger.error("Fallback body dispatch also failed:", { error: fallbackErr });
        }
      }

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
