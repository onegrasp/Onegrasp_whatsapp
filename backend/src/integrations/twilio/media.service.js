const MAX_SIZE = 16 * 1024 * 1024; // 16MB Twilio limit

const mediaService = {
  validateMedia(file) {
    if (!file) {
      throw new Error("No file provided");
    }
    if (file.size > MAX_SIZE) {
      throw new Error(`File is too large (${Math.round(file.size / 1024 / 1024)}MB). Maximum size allowed is 16MB.`);
    }
    return true;
  }
};

module.exports = mediaService;
