// Same rule as the server (backend/src/utils/url.js): only ordinary web links.
// The browser's own type="url" check accepts javascript:, data: and ftp: too.
export const HTTP_URL_MESSAGE = "URL must start with http:// or https://";

export const isHttpUrl = (value) => {
  if (typeof value !== "string") return false;
  try {
    const { protocol, hostname } = new URL(value.trim());
    return (protocol === "http:" || protocol === "https:") && Boolean(hostname);
  } catch (err) {
    return false;
  }
};

// The error to show under a link field, or "" (empty fields are left to `required`).
export const linkError = (value) => (value && !isHttpUrl(value) ? HTTP_URL_MESSAGE : "");
