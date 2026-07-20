const { z } = require("zod");

const sendBulkSchema = z.object({
  phones: z.array(z.string().min(1)).min(1, "At least one phone number is required"),
  templateName: z.string().optional().nullable(),
  message: z.string().optional().nullable(),
  campaignName: z.string().optional().nullable(),
  type: z.enum(["text", "template"]).default("template"),
  params: z.array(z.string()).optional().default([]),
  mediaUrl: z.string().optional().nullable().default(""),
}).refine(
  (data) => {
    if (data.type === "template") return !!data.templateName;
    if (data.type === "text") return !!data.message;
    return true;
  },
  { message: "Template name is required for template type, or message is required for text type" }
);

const validateSendBulk = (data) => {
  return sendBulkSchema.parse(data);
};

module.exports = { validateSendBulk };
