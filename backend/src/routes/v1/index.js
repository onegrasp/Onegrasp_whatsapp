const express = require("express");
const router = express.Router();
const campaignRoutes = require("./campaigns");
const contactRoutes = require("./contacts");
const mediaRoutes = require("./media");
const messageRoutes = require("./messages");
const settingsRoutes = require("./settings");
const templateRoutes = require("./templates");
const webhookRoutes = require("./webhooks");
const healthRoutes = require("./health");
const logsRoutes = require("./logs");

const crypto = require("crypto");
const env = require("../../config/env");
const sessionService = require("../../services/sessionService");
const auditService = require("../../services/auditService");

// Constant-time password comparison that does not leak length via early return.
const passwordMatches = (candidate, expected) => {
  if (!expected) return false; // login disabled until a password is configured
  const a = Buffer.from(String(candidate || ""), "utf8");
  const b = Buffer.from(String(expected), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

// Sign in. Sessions last sessionService.SESSION_HOURS.
router.post("/auth/login", async (req, res) => {
  const { password } = req.body || {};

  if (!env.ADMIN_PASSWORD) {
    return res.status(503).json({
      success: false,
      error: { code: "not_configured", message: "Admin login is not configured on this server." },
    });
  }

  if (passwordMatches(password, env.ADMIN_PASSWORD)) {
    auditService.record("login", "session", null, { ip: req.ip });
    return res.json({ success: true, token: sessionService.issue() });
  }

  auditService.record("login_failed", "session", null, { ip: req.ip });
  // Small delay on failure to blunt rapid guessing.
  await new Promise((resolve) => setTimeout(resolve, 500));

  return res.status(401).json({
    success: false,
    error: {
      code: "unauthorized",
      message: "Invalid admin password"
    }
  });
});

// Sign out: the token stops working immediately, not when it expires.
router.post("/auth/logout", async (req, res) => {
  const token = sessionService.bearerToken(req);
  try {
    if (token && (await sessionService.revoke(token))) {
      auditService.record("logout", "session", null, { ip: req.ip });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: "internal", message: "Could not sign out. Please try again." } });
  }
  return res.json({ success: true, message: "Logged out successfully" });
});

router.use("/", healthRoutes);
router.use("/", logsRoutes);
router.use("/campaigns", campaignRoutes);
router.use("/contacts", contactRoutes);
router.use("/media", mediaRoutes);
router.use("/templates", templateRoutes);
router.use("/settings", settingsRoutes);
router.use("/", webhookRoutes);
router.use("/", messageRoutes);

module.exports = router;
