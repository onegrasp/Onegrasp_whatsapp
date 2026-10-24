const { z } = require("zod");
const { isHttpUrl, HTTP_URL_MESSAGE } = require("../utils/url");

// One-to-one send (Chats and the send-message API). Bounds keep oversized or
// malformed input away from the provider.
const sendMessageSchema = z.object({
  phone: z.string().min(6, "Invalid phone number length").max(32, "Invalid phone number length"),
  message: z.string().max(4096, "Message is too long (WhatsApp allows 4,096 characters)").optional().nullable(),
  type: z.enum(["text", "template"]).default("text"),
  templateName: z.string().max(200).optional().nullable(),
  params: z.array(z.union([z.string(), z.number()]).transform(String).pipe(z.string().max(1024))).max(20).optional().default([]),
  mediaUrl: z.string().max(2048).refine(isHttpUrl, HTTP_URL_MESSAGE).optional().nullable().or(z.literal("")),
}).refine(
  (data) => {
    if (data.type === "template") return !!data.templateName;
    return !!data.message || !!data.mediaUrl;
  },
  { message: "Message or mediaUrl is required for text type, or templateName is required for template type" }
);

const validateSendMessage = (data) => {
  return sendMessageSchema.parse(data);
};

module.exports = { validateSendMessage };
