const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const env = require("../config/env");

// General API rate limiter — generous for normal app usage
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

// Strict limiter for auth endpoints only (prevent brute-force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: "rate_limit",
      message: "Too many login attempts, please try again after 15 minutes",
    },
  },
});

// Strict limiter for send endpoints (prevent message spam)
const sendLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: env.NODE_ENV === "production" ? 30 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: "rate_limit",
      message: "Too many messages sent, please slow down",
    },
  },
});

const applySecurity = (app) => {
  app.use(helmet());
  app.set("trust proxy", 1);
  app.use("/api", apiLimiter);
  app.use("/api/v1/auth", authLimiter);
  app.use("/api/v1/send-bulk", sendLimiter);
  app.use("/api/v1/send-message", sendLimiter);
};

module.exports = { applySecurity, apiLimiter, authLimiter, sendLimiter };
