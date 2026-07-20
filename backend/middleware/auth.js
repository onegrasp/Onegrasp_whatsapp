const jwt = require("jsonwebtoken");
const env = require("../config/env");

const authenticateToken = (req, res, next) => {
  if (
    req.path.startsWith("/webhook/") ||
    req.path === "/auth/login" ||
    req.path === "/health" ||
    req.path === "/ready" ||
    req.path === "/live" ||
    req.path === "/logs"
  ) {
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
        message: "Invalid token"
      }
    });
  }
};

module.exports = authenticateToken;
