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

    if (resolvedContentSid) {
      options.contentSid = resolvedContentSid;
      if (params) {
        let variables = {};

        // Fetch template from repository to inspect variable names registered with Meta/Twilio
        let tplVarNames = [];
        try {
          const templateRepo = require("../../repositories/templateRepository");
          let tpl = await templateRepo.findByContentSid(resolvedContentSid);
          if (!tpl) tpl = await templateRepo.findByName(templateName);
          if (tpl && Array.isArray(tpl.variables) && tpl.variables.length > 0) {
            tplVarNames = tpl.variables;
          }
        } catch (e) {}

        if (Array.isArray(params) && params.length > 0) {
          params.forEach((p, index) => {
            const val = String(p);
            // 1. Assign numeric key ("1", "2", etc.)
            variables[String(index + 1)] = val;
            
            // 2. Assign registered variable name if available
            if (tplVarNames[index]) {
              variables[String(tplVarNames[index])] = val;
            } else {
              // 3. Fallback common variable keys
              variables["name"] = val;
              variables["customer_name"] = val;
            }
          });
        } else if (typeof params === "object" && params !== null) {
          Object.keys(params).forEach((k, idx) => {
            const val = String(params[k]);
            variables[k] = val;
            variables[String(idx + 1)] = val;
          });
        }

        if (Object.keys(variables).length > 0) {
          options.contentVariables = JSON.stringify(variables);
        }
      }

      if (mediaUrl && typeof mediaUrl === "string" && mediaUrl.trim() && mediaUrl.trim().startsWith("http")) {
        options.mediaUrl = [mediaUrl.trim()];
      }
    } else {
      // Fallback: If template is a simple text template or no HX SID is registered yet
      let body = templateName;
      if (Array.isArray(params)) {
        params.forEach((p, index) => {
          body = body.replace(new RegExp(`\\{\\{${index + 1}\\}\\}`, "g"), p);
        });
      }
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
