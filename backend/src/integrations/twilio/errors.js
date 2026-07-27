const mapTwilioError = (err) => {
  const code = err.code || err.status || null;
  let message = err.message || String(err);
  let category = "other";

  if (code) {
    switch (code) {
      case 63016:
      case 63018:
        category = "session_window_expired";
        message = `Twilio Error ${code}: Outside 24-hour window. WhatsApp policy requires sending an approved Template, or the customer must message your WhatsApp number first.`;
        break;
      case 21610:
        category = "opt_out";
        message = `Twilio Error 21610: Recipient has opted out of receiving messages.`;
        break;
      case 21614:
      case 21211:
        category = "invalid_phone";
        break;
      case 63024:
        category = "template_rejection";
        break;
      case 63015:
      case 20429:
        category = "rate_limit";
        break;
      case 20003:
        category = "auth_error";
        break;
      default:
        category = "other";
    }
  } else if (message.toLowerCase().includes("timeout")) {
    category = "timeout";
  } else if (message.toLowerCase().includes("auth") || message.toLowerCase().includes("credential")) {
    category = "auth_error";
  }

  return {
    code,
    message,
    category,
  };
};

module.exports = { mapTwilioError };
