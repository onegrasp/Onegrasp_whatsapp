const conversationRepository = require("../repositories/conversationRepository");
const messageRepository = require("../repositories/messageRepository");

const MAX_MESSAGES_PAGE = 200;

const messageService = {
  async getConversations(query) {
    const { search } = query;
    // Searched in the database, so older conversations are found too (the
    // list itself shows the most recent ones).
    const conversations = await conversationRepository.findAll({ search });

    return (conversations || []).map((c) => {
      const contact = Array.isArray(c.contacts) ? c.contacts[0] : c.contacts;
      return {
        phone: c.phone,
        name: contact?.name || c.contact_name || c.phone,
        label: contact?.label || "none",
        isImportant: contact?.is_important || false,
        isOptedOut: contact?.is_active === false,
        lastMessage: c.last_message,
        lastDirection: c.last_direction,
        lastStatus: c.last_status,
        lastTimestamp: c.last_timestamp,
        unreadCount: c.unread_count,
      };
    });
  },

  async getMessages(phone, page = 1, limit = 50) {
    await conversationRepository.resetUnreadCount(phone);

    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeLimit = Math.min(MAX_MESSAGES_PAGE, Math.max(1, parseInt(limit, 10) || 50));
    const { data, count } = await messageRepository.findByPhone(phone, safePage, safeLimit);

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
      mediaUrl: m.media_url || "",
      templateName: m.template_name || "",
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
};

module.exports = messageService;
