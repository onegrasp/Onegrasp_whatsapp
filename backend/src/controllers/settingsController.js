const settingsService = require("../services/settingsService");
const { validateSettings } = require("../validators/settings.validator");

const getSettings = async (req, res, next) => {
  try {
    const settings = await settingsService.getSettings();
    res.json(settings);
  } catch (err) {
    next(err);
  }
};

const updateSettings = async (req, res, next) => {
  try {
    const validated = validateSettings(req.body);
    const result = await settingsService.updateSettings(validated);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getSettings,
  updateSettings,
};
