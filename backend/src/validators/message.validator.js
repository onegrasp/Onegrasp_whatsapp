const { z } = require("zod");

const sendMessageSchema = z.object({
  phone: z.string().min(6, "Invalid phone number length"),
  message: z.string().optional().nullable(),
  type: z.enum(["text", "template"]).default("text"),
  templateName: z.string().optional().nullable(),
  params: z.array(z.string()).optional().default([]),
  mediaUrl: z.string().optional().nullable(),
}).refine(
  (data) => {
    if (data.type === "template") return !!data.templateName;
    return !!data.message;
  },
  { message: "Message is required for text type, or templateName is required for template type" }
);

const validateSendMessage = (data) => {
  return sendMessageSchema.parse(data);
};

module.exports = { validateSendMessage };
