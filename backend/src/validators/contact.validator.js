const { z } = require("zod");

const updateLabelSchema = z.object({
  label: z.string().min(1, "Label cannot be empty"),
});

const validateUpdateLabel = (data) => {
  return updateLabelSchema.parse(data);
};

module.exports = { validateUpdateLabel };
