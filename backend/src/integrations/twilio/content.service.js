const { getTwilioClient } = require("./client");
const { mapTemplateToTwilioPayload } = require("./mapper");
const { runWithRetry } = require("./retry");
const { mapTwilioError } = require("./errors");

const contentService = {
  async createTemplate(templateData) {
    const client = await getTwilioClient();
    const payload = mapTemplateToTwilioPayload(templateData);

    try {
      const content = await runWithRetry(() => client.content.v1.contents.create(payload));
      return { sid: content.sid };
    } catch (err) {
      const errorDetails = mapTwilioError(err);
      const customErr = new Error(errorDetails.message);
      customErr.code = errorDetails.code;
      customErr.category = errorDetails.category;
      throw customErr;
    }
  },

  async submitForApproval(contentSid, templateData) {
    const client = await getTwilioClient();
    const cleanName = templateData.name.toLowerCase().replace(/[^a-z0-9_]/g, "_");

    try {
      const approval = await runWithRetry(() =>
        client.content.v1
          .contents(contentSid)
          .approvalRequests()
          .create({
            name: cleanName,
            category: templateData.category || "UTILITY",
            language: templateData.language || "en",
          })
      );
      return {
        status: approval.whatsapp?.status || "pending",
        rejectionReason: approval.whatsapp?.rejection_reason || "",
      };
    } catch (err) {
      const errorDetails = mapTwilioError(err);
      const customErr = new Error(errorDetails.message);
      customErr.code = errorDetails.code;
      customErr.category = errorDetails.category;
      throw customErr;
    }
  },

  async fetchApprovalStatus(contentSid) {
    const client = await getTwilioClient();
    try {
      const approval = await runWithRetry(() =>
        client.content.v1
          .contents(contentSid)
          .approvalRequests()
          .fetch()
      );
      return {
        status: approval.whatsapp?.status || "pending",
        rejectionReason: approval.whatsapp?.rejection_reason || "",
      };
    } catch (err) {
      const errorDetails = mapTwilioError(err);
      const customErr = new Error(errorDetails.message);
      customErr.code = errorDetails.code;
      customErr.category = errorDetails.category;
      throw customErr;
    }
  },

  async fetchTemplatesList(limit = 100) {
    const client = await getTwilioClient();
    try {
      const templates = await runWithRetry(() => client.content.v1.contents.list({ limit }));
      return templates || [];
    } catch (err) {
      const errorDetails = mapTwilioError(err);
      const customErr = new Error(errorDetails.message);
      customErr.code = errorDetails.code;
      customErr.category = errorDetails.category;
      throw customErr;
    }
  }
};

module.exports = contentService;
