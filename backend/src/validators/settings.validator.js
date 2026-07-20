const { z } = require("zod");

const settingsSchema = z.record(z.any());

const validateSettings = (data) => {
  return settingsSchema.parse(data);
};

module.exports = { validateSettings };
