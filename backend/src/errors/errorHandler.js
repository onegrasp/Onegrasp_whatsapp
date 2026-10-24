const { getContext } = require("../context/requestContext");
const logger = require("../utils/logger");

const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let code = err.category || "internal";
  let message = err.message || "Internal server error";

  if (err.name === "ZodError" || err.issues) {
    statusCode = 400;
    code = "validation_error";
    message = err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ");
  }

  // Postgres unique violation, e.g. 'duplicate key value violates unique
  // constraint "templates_name_key"'. Show which value is taken instead.
  if (err.code === "23505") {
    statusCode = 409;
    code = "duplicate";
    const match = /Key \((\w+)\)=\((.*)\) already exists/.exec(err.details || "");
    message = match
      ? `The ${match[1]} "${match[2]}" is already in use. Choose a different ${match[1]}.`
      : "This record already exists.";
  }

  const { requestId } = getContext();

  // Client mistakes (4xx) are routine: a warning without a stack trace.
  if (statusCode < 500) {
    logger.warn(`Request rejected: ${message}`, { statusCode, code });
  } else {
    logger.error(`Error processing request: ${message}`, {
      statusCode,
      code,
      error: err,
    });
  }

  // Errors from Twilio's API (e.g. a template it rejected) are meant for the
  // operator, so their message is passed through. Other unexpected server
  // errors can carry internal details (database, network, stack info): clients
  // get a plain message and a reference, and the real cause is in the log above.
  const isProviderError = !err.statusCode && typeof err.moreInfo === "string" && /twilio\.com/.test(err.moreInfo);
  if (isProviderError) {
    statusCode = 502;
    code = "provider_error";
    message = `Twilio: ${err.message}`;
  } else if (statusCode >= 500 && !err.isOperational) {
    code = "internal";
    message = `Something went wrong on the server. Please try again. (Reference: ${String(requestId || "n/a").slice(0, 8)})`;
  }

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
    },
    requestId: requestId || null,
  });
};

module.exports = errorHandler;
