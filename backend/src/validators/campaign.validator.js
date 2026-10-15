const { z } = require("zod");

const sendBulkSchema = z.object({
  phones: z.preprocess(
    (val) => (typeof val === "string" ? [val] : val),
    z.array(z.string().min(1)).min(1, "At least one phone number is required")
  ),
  templateName: z.string().optional().nullable(),
  message: z.string().optional().nullable(),
  campaignName: z.string().optional().nullable(),
  type: z.enum(["text", "template"]).default("template"),
  params: z.array(z.string()).optional().default([]),
  mediaUrl: z.string().optional().nullable().default(""),
  scheduledAt: z.string().optional().nullable(),
}).refine(
  (data) => {
    if (data.type === "template") return !!data.templateName;
    if (data.type === "text") return !!data.message || !!data.mediaUrl;
    return true;
  },
  { message: "Template name is required for template type, or message/mediaUrl is required for text type" }
);

const validateSendBulk = (data) => {
  return sendBulkSchema.parse(data);
};

module.exports = { validateSendBulk };
