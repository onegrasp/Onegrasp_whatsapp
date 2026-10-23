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
