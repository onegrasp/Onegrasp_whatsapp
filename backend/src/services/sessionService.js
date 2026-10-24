const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const env = require("../config/env");
const settingsRepository = require("../repositories/settingsRepository");
const logger = require("../utils/logger");

/**
 * Admin sessions are JWTs. Each carries an id (jti) so signing out can block
 * that token on the server until it would have expired anyway. Blocked ids are
 * kept in the settings table, so they survive restarts.
 */
const SESSION_HOURS = 12;
const REVOKED_KEY = "revokedSessions";
const RELOAD_MS = 60 * 1000;

const revoked = new Map(); // jti -> exp (unix seconds)
let loadedAt = 0;

const pruneExpired = () => {
  const now = Date.now() / 1000;
  for (const [jti, exp] of revoked) if (!exp || exp < now) revoked.delete(jti);
};

const reloadRevoked = async () => {
  if (Date.now() - loadedAt < RELOAD_MS) return;
  loadedAt = Date.now();
  try {
    const row = await settingsRepository.findByKey(REVOKED_KEY);
    (Array.isArray(row?.value) ? row.value : []).forEach(({ jti, exp }) => jti && revoked.set(jti, exp));
    pruneExpired();
  } catch (err) {
    // Keep using what's in memory.
    logger.warn("Could not load signed-out sessions", { error: err.message });
  }
};

const issue = () =>
  jwt.sign({ role: "admin", jti: crypto.randomUUID() }, env.JWT_SECRET, { expiresIn: `${SESSION_HOURS}h` });

// Resolves to the token payload, or throws if the token is invalid, expired or signed out.
const verify = async (token) => {
  const payload = jwt.verify(token, env.JWT_SECRET);
  await reloadRevoked();
  if (payload.jti && revoked.has(payload.jti)) throw new Error("This session was signed out.");
  return payload;
};

const revoke = async (token) => {
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch (err) {
    return false; // Already invalid.
  }
  if (!payload.jti) return false;
  revoked.set(payload.jti, payload.exp);
  pruneExpired();
  await settingsRepository.upsert(REVOKED_KEY, [...revoked].map(([jti, exp]) => ({ jti, exp })));
  return true;
};

const bearerToken = (req) => {
  const header = req.headers["authorization"] || "";
  return /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, "").trim() : "";
};

module.exports = { issue, verify, revoke, bearerToken, REVOKED_KEY, SESSION_HOURS };
