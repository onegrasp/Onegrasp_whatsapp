const { getContext } = require("../context/requestContext");

const logHistory = [];
const MAX_LOG_HISTORY = 500;

const formatLog = (level, message, context = {}) => {
  const reqContext = getContext();
  const logObj = {
    timestamp: new Date().toISOString(),
    level,
    message,
    requestId: reqContext.requestId || null,
    correlationId: reqContext.correlationId || null,
    userId: reqContext.userId || null,
    ...context,
  };

  if (logObj.authToken) logObj.authToken = "••••••••";
  if (logObj.password) logObj.password = "••••••••";
  if (logObj.twilioAuthToken) logObj.twilioAuthToken = "••••••••";

  if (context.error && context.error instanceof Error) {
    logObj.error = {
      message: context.error.message,
      stack: context.error.stack,
      code: context.error.code,
    };
  }

  logHistory.push(logObj);
  if (logHistory.length > MAX_LOG_HISTORY) {
    logHistory.shift();
  }

  return JSON.stringify(logObj);
};

const logger = {
  info: (message, context) => {
    console.log(formatLog("INFO", message, context));
  },
  warn: (message, context) => {
    console.warn(formatLog("WARN", message, context));
  },
  error: (message, context) => {
    console.error(formatLog("ERROR", message, context));
  },
  debug: (message, context) => {
    if (process.env.NODE_ENV !== "production") {
      console.log(formatLog("DEBUG", message, context));
    }
  },
  getHistory: () => {
    return logHistory;
  }
};

module.exports = logger;
