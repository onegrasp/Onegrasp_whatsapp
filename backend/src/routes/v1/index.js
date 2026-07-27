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
const JWT_SECRET = process.env.JWT_SECRET || "whatsapp-bulk-messaging-system-secret-key-12345";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// Auth login route with anti-timing attack delay and 24h session expiration
router.post("/auth/login", async (req, res) => {
  const { password } = req.body || {};
  const expectedPassword = process.env.ADMIN_PASSWORD || "admin123";
  const jwtSecret = process.env.JWT_SECRET || "whatsapp-bulk-messaging-system-secret-key-12345";
  
  if (password === expectedPassword) {
    const token = jwt.sign({ role: "admin", iat: Math.floor(Date.now() / 1000) }, jwtSecret, { expiresIn: "24h" });
    return res.json({ success: true, token });
  }

  // Artificial 500ms delay on failure to prevent timing attack enumeration
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
