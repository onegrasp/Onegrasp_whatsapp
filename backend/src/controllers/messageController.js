const messageService = require("../services/messageService");
const { validateSendMessage } = require("../validators/message.validator");

const getConversations = async (req, res, next) => {
  try {
    const result = await messageService.getConversations(req.query);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const getMessages = async (req, res, next) => {
  try {
    const { phone } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const result = await messageService.getMessages(phone, page, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const getStats = async (req, res, next) => {
  try {
    const result = await messageService.getStats();
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const sendMessage = async (req, res, next) => {
  try {
    const validated = validateSendMessage(req.body);
    const io = req.app.get("io");
    const result = await messageService.sendSingleMessage(validated, io);
    res.json({ message: "Message sent", data: result });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getConversations,
  getMessages,
  getStats,
  sendMessage,
};
