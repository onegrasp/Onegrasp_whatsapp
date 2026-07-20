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

  const { requestId } = getContext();

  logger.error(`Error processing request: ${message}`, {
    statusCode,
    code,
    error: err,
  });

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
