/**
 * Comprehensive Meta WhatsApp Business (Cloud) API Error Mapper
 * Maps Meta Graph API error codes to standardized internal failure categories.
 */

const mapMetaError = (err) => {
  if (!err) {
    return {
      category: "other",
      code: 0,
      message: "Unknown error occurred",
      details: {},
    };
  }

  // Extract Meta API response error object if wrapped in Axios / HTTP response
  const metaError = err.response?.data?.error || err.error || err;

  const code = metaError.code || metaError.error_subcode || err.statusCode || 0;
  const subcode = metaError.error_subcode || 0;
  const message = metaError.message || err.message || "Meta API request failed";
  const errorData = metaError.error_data || {};
  const fbtraceId = metaError.fbtrace_id || "";

  let category = "other";

  // Meta Error Code & Subcode Classification
  if (code === 131047 || subcode === 131047 || code === 470) {
    category = "session_window_expired";
  } else if (code === 132000 || code === 132001 || subcode === 132000 || subcode === 132001 || (code === 100 && /template/i.test(message))) {
    category = "template_param_mismatch";
  } else if (code === 131008 || code === 131002 || code === 21614 || (code === 100 && /recipient|phone|to/i.test(message))) {
    category = "invalid_phone";
  } else if (code === 130429 || code === 80007 || code === 429 || subcode === 130429) {
    category = "rate_limit";
  } else if (code === 190 || code === 102 || code === 3) {
    category = "auth_error";
  } else if (code === 131026 || code === 131009) {
    category = "message_undeliverable";
  } else if (code === 131030 || code === 131056) {
    category = "opt_out";
  } else if (code === 131051 || code === 131052 || code === 131053) {
    category = "media_error";
  }

  return {
    category,
    code,
    subcode,
    message: `Meta API Error (${code}${subcode ? `/${subcode}` : ""}): ${message}`,
    fbtraceId,
    details: metaError,
  };
};

module.exports = { mapMetaError };
