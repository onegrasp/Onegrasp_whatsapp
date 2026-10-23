const campaignService = require("../services/campaignService");
const { campaignControl } = require("../services/campaignControl");

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

const pauseCampaign = async (req, res, next) => {
  try {
    await campaignControl.pause(req.params.id, "Paused by admin");
    res.json({ success: true, status: "paused" });
  } catch (err) {
    next(err);
  }
};

const resumeCampaign = async (req, res, next) => {
  try {
    await campaignControl.resume(req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

const cancelCampaign = async (req, res, next) => {
  try {
    const result = await campaignControl.cancel(req.params.id);
    res.json({ success: true, status: "cancelled", ...result });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getCampaigns,
  getCampaignMessages,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
};
