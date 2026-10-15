const express = require("express");
const router = express.Router();
const {
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  submitTemplate,
  syncTemplateStatus,
  syncTemplates,
} = require("../controllers/templateController");

// Template CRUD routes
router.get("/templates", getTemplates);
router.get("/templates/:id", getTemplateById);
router.post("/templates", createTemplate);
router.put("/templates/:id", updateTemplate);
router.delete("/templates/:id", deleteTemplate);

// WhatsApp template approval routes
router.post("/templates/sync", syncTemplates);
router.post("/templates/:id/submit", submitTemplate);
router.get("/templates/:id/status", syncTemplateStatus);

module.exports = router;
