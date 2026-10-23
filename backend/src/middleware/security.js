const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const env = require("../config/env");

// Rate-limit keys use express-rate-limit's default generator, which reads the
// client IP from `req.ip`. Combined with a trusted single-hop proxy
// (`trust proxy = 1`), this prevents clients from rotating the raw
// X-Forwarded-For header to evade the limits (previously possible).

// General API rate limiter — generous for normal app usage (500 requests / 15 mins)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === "production" ? 500 : 5000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: "rate_limit",
      message: "Too many requests from this IP, please try again later",
    },
  },
});

// Strict limiter for auth login endpoint (anti-brute-force: 5 failed attempts / 15 mins).
// Successful logins don't count, so signing in normally never locks you out.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: "rate_limit",
      message: "Too many failed login attempts. Account locked for this IP. Please try again after 15 minutes.",
    },
  },
});

// One-to-one chat replies. Generous, so an agent answering quickly isn't blocked.
const chatSendLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: env.NODE_ENV === "production" ? 120 : 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: "rate_limit", message: "Too many messages sent in a minute. Please wait a moment and try again." },
  },
});

// Campaign creation and control (each bulk send is preceded by a preflight check).
const bulkSendLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: env.NODE_ENV === "production" ? 20 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: "rate_limit", message: "Too many campaign operations in a minute. Please wait a minute before retrying." },
  },
});

// Kept for compatibility with existing imports.
const sendLimiter = bulkSendLimiter;

// The API is mounted at both /api/v1 and /api, so limits must cover both.
const bothPrefixes = (...paths) => paths.flatMap((p) => [`/api/v1${p}`, `/api${p}`]);
const postOnly = (limiter) => (req, res, next) => (req.method === "POST" ? limiter(req, res, next) : next());

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
  app.use(bothPrefixes("/auth/login"), authLimiter);
  app.use(bothPrefixes("/send-message", "/send-single", "/send/single"), chatSendLimiter);
  app.use(bothPrefixes("/send-bulk", "/send/bulk", "/campaigns"), postOnly(bulkSendLimiter));
};

module.exports = { applySecurity, apiLimiter, authLimiter, sendLimiter, chatSendLimiter, bulkSendLimiter };
