const settingsRepository = require("../repositories/settingsRepository");
const { clearTwilioConfigCache } = require("../config/twilio");

const settingsService = {
  async getSettings() {
    const settings = await settingsRepository.findAll();
    const settingsObj = {};

    (settings || []).forEach((s) => {
      settingsObj[s.key] = s.value;
    });

    if (settingsObj.autoReplyEnabled === undefined) settingsObj.autoReplyEnabled = false;
    if (settingsObj.autoReplyMessage === undefined) {
      settingsObj.autoReplyMessage = "Thank you for reaching out! We have received your message and will get back shortly.";
    }
    if (settingsObj.twilioMode === undefined) settingsObj.twilioMode = "sandbox";
    if (settingsObj.twilioAccountSid === undefined) settingsObj.twilioAccountSid = "";
    if (settingsObj.twilioAuthToken === undefined) settingsObj.twilioAuthToken = "";
    if (settingsObj.twilioWhatsappNumber === undefined) settingsObj.twilioWhatsappNumber = "";
    if (settingsObj.twilioMessagingServiceSid === undefined) settingsObj.twilioMessagingServiceSid = "";
    if (settingsObj.validateWebhookSignature === undefined) settingsObj.validateWebhookSignature = false;
    if (settingsObj.sendingRate === undefined) settingsObj.sendingRate = 2;

    if (settingsObj.twilioAuthToken) {
      settingsObj.twilioAuthToken = "••••••••";
    }

    return settingsObj;
  },

  async updateSettings(body) {
    const fields = [
      "autoReplyEnabled",
      "autoReplyMessage",
      "twilioMode",
      "twilioAccountSid",
      "twilioAuthToken",
      "twilioWhatsappNumber",
      "twilioMessagingServiceSid",
      "validateWebhookSignature",
      "sendingRate",
    ];

    for (const field of fields) {
      if (body[field] !== undefined) {
        let val = body[field];
        if (field === "sendingRate") val = Number(val) || 2;

        if (field === "twilioAuthToken" && val === "••••••••") {
          continue;
        }

        await settingsRepository.upsert(field, val);
      }
    }

    clearTwilioConfigCache();

    return { message: "Settings updated successfully" };
  }
};

module.exports = settingsService;
