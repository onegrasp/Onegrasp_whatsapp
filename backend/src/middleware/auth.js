const sessionService = require("../services/sessionService");
const { getContext } = require("../context/requestContext");

const PUBLIC_EXACT_ROUTES = new Set([
  "/auth/login",
  "/api/v1/auth/login",
  "/api/auth/login",
  "/health",
  "/api/v1/health",
  "/api/health",
  "/ready",
  "/api/v1/ready",
  "/api/ready",
  "/live",
  "/api/v1/live",
  "/api/live",
  "/webhook",
  "/api/v1/webhook",
  "/api/webhook",
  "/webhooks",
  "/api/v1/webhooks",
  "/api/webhooks",
  "/jobs/process-queue",
  "/api/jobs/process-queue",
  "/api/v1/jobs/process-queue"
]);

const PUBLIC_PATH_PREFIXES = [
  "/webhook",
  "/webhooks",
  "/api/v1/webhook",
  "/api/v1/webhooks",
  "/api/webhook",
  "/api/webhooks",
  "/auth",
  "/api/v1/auth",
  "/api/auth"
];

const authenticateToken = async (req, res, next) => {
  // Normalize request path without query strings
  const rawPath = (req.path || req.baseUrl || "").toLowerCase();
  const normalizedPath = rawPath.replace(/\/+$/, "") || "/";

  // Check exact matches or valid public webhook prefixes
  const isPublicExact = PUBLIC_EXACT_ROUTES.has(normalizedPath);
  const isPublicPrefix = PUBLIC_PATH_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix));

  if (isPublicExact || isPublicPrefix) {
    return next();
  }

  const token = sessionService.bearerToken(req);

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
    req.user = await sessionService.verify(token);
  } catch (err) {
    // 401 (not 403) so the app sends the user back to the sign-in screen.
    return res.status(401).json({
      success: false,
      error: {
        code: "session_expired",
        message: "Your session has expired. Please sign in again."
      }
    });
  }
  // Attribute this request's logs and audit entries.
  getContext().userId = req.user.role || "admin";
  next();
};

module.exports = authenticateToken;
