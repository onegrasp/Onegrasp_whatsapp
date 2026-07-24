const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const env = require("../config/env");

const getClientIp = (req) => {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "127.0.0.1"
  );
};

// General API rate limiter — generous for normal app usage (500 requests / 15 mins)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === "production" ? 500 : 5000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
  validate: { trustProxy: false },
  message: {
    success: false,
    error: {
      code: "rate_limit",
      message: "Too many requests from this IP, please try again later",
    },
  },
});

// Strict limiter for auth login endpoint (anti-brute-force: max 10 attempts / 15 mins)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
  validate: { trustProxy: false },
  message: {
    success: false,
    error: {
      code: "rate_limit",
      message: "Too many failed login attempts. Please try again after 15 minutes.",
    },
  },
});

// Strict limiter for message broadcast endpoints (prevent spamming: max 30 sends / min)
const sendLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: env.NODE_ENV === "production" ? 30 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
  validate: { trustProxy: false },
  message: {
    success: false,
    error: {
      code: "rate_limit",
      message: "Too many broadcast operations initiated, please wait a minute before retrying.",
    },
  },
});

const applySecurity = (app) => {
  // Trust proxy for accurate IP resolution behind Vercel/Render reverse proxies
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // Apply Helmet HTTP security headers
  app.use(
    helmet({
      contentSecurityPolicy: false, // Allows flexible cross-origin media rendering
      crossOriginResourcePolicy: { policy: "cross-origin" },
      frameguard: { action: "deny" }, // Prevents clickjacking in iframe embeds
      noSniff: true, // Prevents MIME-type sniffing
      xssFilter: true, // Anti-XSS header protection
    })
  );

  // Apply rate limiters across sensitive route clusters
  app.use("/api", apiLimiter);
  app.use("/api/v1/auth", authLimiter);
  app.use("/api/auth", authLimiter);
  app.use("/api/v1/send-bulk", sendLimiter);
  app.use("/api/v1/send-message", sendLimiter);
};

module.exports = { applySecurity, apiLimiter, authLimiter, sendLimiter };
