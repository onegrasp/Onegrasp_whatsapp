const crypto = require("crypto");

/**
 * Encrypts secrets stored in the settings table (AES-256-GCM). The key comes
 * from SETTINGS_ENCRYPTION_KEY, or JWT_SECRET when that isn't set. Without
 * either (local development with a throwaway JWT secret), values are stored
 * as plain text, as before.
 *
 * If the key changes, saved secrets can't be decrypted; they read as empty,
 * so the app falls back to the environment variables until they're re-entered.
 */
const PREFIX = "enc:v1:";

const keyMaterial = () => process.env.SETTINGS_ENCRYPTION_KEY || process.env.JWT_SECRET || "";

const deriveKey = (material) => Buffer.from(crypto.hkdfSync("sha256", material, "onegrasp", "settings-encryption", 32));

const isEncrypted = (value) => typeof value === "string" && value.startsWith(PREFIX);

const canEncrypt = () => Boolean(keyMaterial());

const encrypt = (plain) => {
  if (typeof plain !== "string" || !plain || isEncrypted(plain) || !canEncrypt()) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(keyMaterial()), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
};

// Throws if the value is encrypted but can't be decrypted with the current key.
const decrypt = (value) => {
  if (!isEncrypted(value)) return value;
  if (!canEncrypt()) throw new Error("No encryption key is configured");
  const raw = Buffer.from(value.slice(PREFIX.length), "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(keyMaterial()), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
};

module.exports = { encrypt, decrypt, isEncrypted, canEncrypt };
