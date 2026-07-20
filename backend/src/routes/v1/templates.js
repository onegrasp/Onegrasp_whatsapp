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
} = require("../../controllers/templateController");

// Sync Twilio content builder (Register sync before dynamic parameter routes)
router.post("/sync", syncTemplates);

// Standard Template CRUD
router.get("/", getTemplates);
router.get("/:id", getTemplateById);
router.post("/", createTemplate);
router.put("/:id", updateTemplate);
router.delete("/:id", deleteTemplate);

// Approval submission / status checks
router.post("/:id/submit", submitTemplate);
router.get("/:id/status", syncTemplateStatus);

module.exports = router;
