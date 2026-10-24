// Links the app stores or hands to WhatsApp (button links, header images,
// message attachments) must be ordinary web addresses. Anything else —
// javascript:, data:, ftp:, file: — is refused.
const HTTP_URL_MESSAGE = "URL must start with http:// or https://";

const isHttpUrl = (value) => {
  if (typeof value !== "string") return false;
  try {
    const { protocol, hostname } = new URL(value.trim());
    return (protocol === "http:" || protocol === "https:") && Boolean(hostname);
  } catch (err) {
    return false;
  }
};

module.exports = { isHttpUrl, HTTP_URL_MESSAGE };
