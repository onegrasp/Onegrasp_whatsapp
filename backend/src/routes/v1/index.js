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

// Auth login route
router.post("/auth/login", (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "7d" });
    return res.json({ token });
  }
  res.status(401).json({
    success: false,
    error: {
      code: "unauthorized",
      message: "Invalid password"
    }
  });
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
