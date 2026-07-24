const jwt = require("jsonwebtoken");
const env = require("../config/env");

const PUBLIC_EXACT_ROUTES = new Set([
  "/auth/login",
  "/api/v1/auth/login",
  "/health",
  "/api/v1/health",
  "/ready",
  "/live",
  "/webhook",
  "/api/v1/webhook",
  "/webhooks",
  "/api/v1/webhooks",
  "/jobs/process-queue"
]);

const PUBLIC_PATH_PREFIXES = [
  "/webhook",
  "/webhooks"
];

const authenticateToken = (req, res, next) => {
  // Normalize request path without query strings
  const rawPath = (req.path || req.baseUrl || "").toLowerCase();
  const normalizedPath = rawPath.replace(/\/+$/, "") || "/";

  // Check exact matches or valid public webhook prefixes
  const isPublicExact = PUBLIC_EXACT_ROUTES.has(normalizedPath);
  const isPublicPrefix = PUBLIC_PATH_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix));

  if (isPublicExact || isPublicPrefix) {
    return next();
  }

  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      error: {
        code: "unauthorized",
        message: "Access denied. No token provided."
      }
    });
  }

  try {
    const verified = jwt.verify(token, env.JWT_SECRET || "whatsapp-bulk-messaging-system-secret-key-12345");
    req.user = verified;
    next();
  } catch (err) {
    return res.status(403).json({
      success: false,
      error: {
        code: "forbidden",
        message: "Invalid or expired authorization token"
      }
    });
  }
};

module.exports = authenticateToken;
