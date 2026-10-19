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

const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const env = require("../../config/env");

// Constant-time password comparison that does not leak length via early return.
const passwordMatches = (candidate, expected) => {
  if (!expected) return false; // login disabled until a password is configured
  const a = Buffer.from(String(candidate || ""), "utf8");
  const b = Buffer.from(String(expected), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

// Auth login route with 24h session expiration
router.post("/auth/login", async (req, res) => {
  const { password } = req.body || {};

  if (!env.ADMIN_PASSWORD) {
    return res.status(503).json({
      success: false,
      error: { code: "not_configured", message: "Admin login is not configured on this server." },
    });
  }

  if (passwordMatches(password, env.ADMIN_PASSWORD)) {
    const token = jwt.sign(
      { role: "admin", iat: Math.floor(Date.now() / 1000) },
      env.JWT_SECRET,
      { expiresIn: "24h" }
    );
    return res.json({ success: true, token });
  }

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

// Auth logout route
router.post("/auth/logout", (req, res) => {
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
