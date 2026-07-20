const twilioService = require("./twilioService");
const { getTwilioConfig, clearTwilioConfigCache } = require("../config/twilio");

module.exports = {
  ...twilioService,
  getTwilioConfig,
  clearTwilioConfigCache,
};

