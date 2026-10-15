const axios = require("axios");
const { getMetaConfig } = require("./client");
const { mapMetaError } = require("./errors");
const logger = require("../../utils/logger");

/**
 * Clean & format phone number for Meta WhatsApp Cloud API (digits only, e.g. "919876543210")
 */
const formatToMetaPhone = (phoneStr) => {
  if (!phoneStr) return "";
  return String(phoneStr).replace(/\D/g, "");
};

/**
 * Sanitize template parameter value according to Meta Cloud API constraints:
 * - Strip null bytes
 * - Replace unescaped newlines/tabs with single space (Meta rejects parameters containing line breaks)
 * - Trim excess whitespace
 * - Prevent empty string (Meta requires non-empty parameter strings)
 * - Truncate to Meta 1024 UTF-8 byte limit per parameter
 */
const sanitizeMetaParamValue = (val) => {
  if (val === null || val === undefined) return " ";
  let str = String(val).replace(/\0/g, "").replace(/[\r\n\t]+/g, " ").trim();
  if (!str) str = " ";

  // Truncate to 1024 UTF-8 bytes if needed
  const buf = Buffer.from(str, "utf8");
  if (buf.length > 1024) {
    str = buf.subarray(0, 1024).toString("utf8");
    // Handle potential broken trailing multibyte UTF-8 char
    str = str.replace(/[\uFFFD]/g, "");
  }
  return str;
};

const metaMessagingService = {
  async sendTemplate(to, templateName, params = [], mediaUrl = null, options = {}) {
    const config = await getMetaConfig();

    if (!config.isConfigured) {
      logger.warn("Meta WhatsApp API credentials not configured. Running in SIMULATION mode.");
      return { sid: "wamid.HBgMSUlNUElMQVRFRF8" + Date.now() };
    }

    const recipient = formatToMetaPhone(to);
    const langCode = options.language || "en";

    // Standardize parameter array
    const paramArray = Array.isArray(params)
      ? params
      : (typeof params === "object" && params !== null ? Object.values(params) : []);

    const components = [];

    // 1. Header Media Component (if mediaUrl provided)
    if (mediaUrl && typeof mediaUrl === "string" && mediaUrl.trim().startsWith("http")) {
      const isVideo = /\.(mp4|3gp|mov)$/i.test(mediaUrl);
      const isDoc = /\.(pdf|docx?|xlsx?)$/i.test(mediaUrl);
      const mediaType = isVideo ? "video" : isDoc ? "document" : "image";

      components.push({
        type: "header",
        parameters: [
          {
            type: mediaType,
            [mediaType]: { link: mediaUrl.trim() },
          },
        ],
      });
    }

    // 2. Body Parameters Component
    if (paramArray.length > 0) {
      const bodyParameters = paramArray.map((p) => ({
        type: "text",
        text: sanitizeMetaParamValue(p),
      }));

      components.push({
        type: "body",
        parameters: bodyParameters,
      });
    }

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "template",
      template: {
        name: String(templateName).trim().toLowerCase(),
        language: {
          code: langCode,
        },
      },
    };

    if (components.length > 0) {
      payload.template.components = components;
    }

    const url = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;

    logger.info(`Sending Meta Cloud API Template Message to ${recipient} (Template: ${templateName})`, {
      url,
      payload: JSON.stringify(payload),
    });

    try {
      const res = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        timeout: 15000,
      });

      const messageId = res.data?.messages?.[0]?.id || `wamid_${Date.now()}`;
      logger.info(`Meta API Message Dispatched Successfully. ID: ${messageId}`, { response: res.data });
      return { sid: messageId, data: res.data };
    } catch (err) {
      // Log FULL RAW Meta Error Response for complete diagnosability
      if (err.response) {
        logger.error(`Meta API Response Error (${err.response.status}):`, {
          status: err.response.status,
          statusText: err.response.statusText,
          headers: err.response.headers,
          data: err.response.data,
        });
      } else {
        logger.error(`Meta API Request Failed: ${err.message}`, { error: err });
      }

      const mapped = mapMetaError(err);
      const customErr = new Error(mapped.message);
      customErr.code = mapped.code;
      customErr.subcode = mapped.subcode;
      customErr.category = mapped.category;
      customErr.fbtraceId = mapped.fbtraceId;
      customErr.raw = mapped.details;
      throw customErr;
    }
  },

  async sendText(to, text, mediaUrl = null) {
    const config = await getMetaConfig();

    if (!config.isConfigured) {
      logger.warn("Meta WhatsApp API credentials not configured. Running in SIMULATION mode.");
      return { sid: "wamid.HBgMSUlNUElMQVRFRF8" + Date.now() };
    }

    const recipient = formatToMetaPhone(to);
    let sanitizedText = String(text || "").replace(/\0/g, "");

    // Meta 4096 character limit for text messages
    if (Buffer.byteLength(sanitizedText, "utf8") > 4096) {
      sanitizedText = Buffer.from(sanitizedText, "utf8").subarray(0, 4096).toString("utf8").replace(/[\uFFFD]/g, "");
    }

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
    };

    if (mediaUrl && typeof mediaUrl === "string" && mediaUrl.trim().startsWith("http")) {
      const isVideo = /\.(mp4|3gp|mov)$/i.test(mediaUrl);
      const isDoc = /\.(pdf|docx?|xlsx?)$/i.test(mediaUrl);
      const mediaType = isVideo ? "video" : isDoc ? "document" : "image";

      payload.type = mediaType;
      payload[mediaType] = {
        link: mediaUrl.trim(),
        caption: sanitizedText || undefined,
      };
    } else {
      payload.type = "text";
      payload.text = {
        preview_url: false,
        body: sanitizedText,
      };
    }

    const url = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;

    try {
      const res = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        timeout: 15000,
      });

      const messageId = res.data?.messages?.[0]?.id || `wamid_${Date.now()}`;
      return { sid: messageId, data: res.data };
    } catch (err) {
      if (err.response) {
        logger.error(`Meta API Text Send Error (${err.response.status}):`, {
          status: err.response.status,
          data: err.response.data,
        });
      }

      const mapped = mapMetaError(err);
      const customErr = new Error(mapped.message);
      customErr.code = mapped.code;
      customErr.subcode = mapped.subcode;
      customErr.category = mapped.category;
      customErr.fbtraceId = mapped.fbtraceId;
      customErr.raw = mapped.details;
      throw customErr;
    }
  },

  async markAsRead(messageId) {
    const config = await getMetaConfig();
    if (!config.isConfigured || !messageId) return { success: false };

    const url = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;
    try {
      await axios.post(
        url,
        {
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId,
        },
        {
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );
      return { success: true };
    } catch (err) {
      logger.warn(`Failed to mark message ${messageId} as read in Meta:`, { error: err.message });
      return { success: false, error: err.message };
    }
  },
};

module.exports = metaMessagingService;
