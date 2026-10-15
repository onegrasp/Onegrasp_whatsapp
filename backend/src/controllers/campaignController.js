const campaignService = require("../services/campaignService");
const { validateSendBulk } = require("../validators/campaign.validator");

const sendBulk = async (req, res, next) => {
  try {
    const validated = validateSendBulk(req.body);
    const io = req.app.get("io");
    const result = await campaignService.sendBulk(validated, io);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const getCampaigns = async (req, res, next) => {
  try {
    const result = await campaignService.getCampaigns();
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const getCampaignMessages = async (req, res, next) => {
  try {
    const result = await campaignService.getCampaignMessages(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  sendBulk,
  getCampaigns,
  getCampaignMessages,
};
