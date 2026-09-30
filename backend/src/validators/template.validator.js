const { z } = require("zod");

const buttonSchema = z.object({
  type: z.enum(["quick_reply", "reply", "URL", "phone", "call_to_action"]),
  text: z.string().min(1, "Button text is required"),
  url: z.string().url("Invalid URL format").optional().nullable().or(z.literal("")),
  phone: z.string().optional().nullable().or(z.literal("")),
});

const templateSchema = z.object({
  name: z.string().min(1, "Template name is required").regex(/^[a-z0-9_]+$/, "Template name must be lowercase alphanumeric with underscores"),
  body: z.string().min(1, "Template body text is required"),
  type: z.string().optional().default("text"),
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]).default("UTILITY"),
  language: z.string().min(2).max(5).default("en"),
  variables: z.array(z.string()).optional().default([]),
  buttons: z.array(buttonSchema).optional().default([]),
  headerImageUrl: z.string().url("Invalid header image URL").optional().nullable().or(z.literal("")),
  version: z.number().int().positive().optional().default(1),
});

const validateTemplate = (data) => {
  return templateSchema.parse(data);
};

module.exports = { validateTemplate };
