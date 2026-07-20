const supabase = require("../config/supabase");
const client = require("../integrations/twilio/client");
const metrics = require("../utils/metrics");

const getLive = (req, res) => {
  const stats = metrics.getStats();
  res.json({
    success: true,
    status: "alive",
    timestamp: new Date(),
    uptime: process.uptime(),
    metrics: stats,
  });
};

const getReady = async (req, res) => {
  const status = {
    database: "unknown",
    twilio: "unknown",
  };

  let code = 200;

  try {
    const start = Date.now();
    const { error } = await supabase.from("settings").select("key").limit(1);
    metrics.recordDbLatency(Date.now() - start);
    if (error) throw error;
    status.database = "ready";
  } catch (err) {
    status.database = "error: " + err.message;
    code = 503;
  }

  try {
    const twilioConfig = await client.getTwilioConfig();
    const hasAuthToken = !!(twilioConfig.accountSid && twilioConfig.authToken);
    const hasApiKey = !!(twilioConfig.apiKey && twilioConfig.apiSecret);
    const hasAuth = hasAuthToken || hasApiKey;

    if (hasAuth) {
      status.twilio = "ready";
    } else {
      status.twilio = "missing_credentials";
      code = 503;
    }
  } catch (err) {
    status.twilio = "error: " + err.message;
    code = 503;
  }

  res.status(code).json({
    success: code === 200,
    timestamp: new Date(),
    status,
  });
};

const getHealth = async (req, res) => {
  const stats = metrics.getStats();
  res.json({
    success: true,
    status: "healthy",
    version: "1.0.0",
    uptime: process.uptime(),
    memory: stats.memory,
  });
};

module.exports = {
  getLive,
  getReady,
  getHealth,
};
