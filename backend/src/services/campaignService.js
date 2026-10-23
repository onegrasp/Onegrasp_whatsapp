const campaignRepository = require("../repositories/campaignRepository");
const messageRepository = require("../repositories/messageRepository");

// Campaign creation lives in controllers/bulkSendController.js, so every
// campaign goes through the same opt-out, cooldown and daily-limit checks.
const campaignService = {
  async getCampaigns() {
    const campaigns = await campaignRepository.findAll();
    return campaigns.map((c) => ({
      _id: c.id,
      name: c.name,
      message: c.message,
      templateName: c.template_name,
      type: c.type,
      totalContacts: c.total_contacts,
      sentCount: c.sent_count,
      deliveredCount: c.delivered_count,
      readCount: c.read_count,
      failedCount: c.failed_count,
      status: c.status,
      statusReason: c.status_reason || "",
      createdAt: c.created_at,
    }));
  },

  async getCampaignMessages(campaignId) {
    const messages = await messageRepository.findByCampaignId(campaignId);
    return messages.map((m) => ({
      _id: m.id,
      phone: m.phone,
      contactName: m.contact_name,
      text: m.text,
      type: m.type,
      direction: m.direction,
      status: m.status,
      messageId: m.message_id,
      errorDetails: m.error_details,
      errorCategory: m.error_category,
      timestamp: m.timestamp,
    }));
  },
};

module.exports = campaignService;
