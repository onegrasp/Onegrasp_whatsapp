const { AsyncLocalStorage } = require("async_hooks");
const crypto = require("crypto");

const requestContextStore = new AsyncLocalStorage();

const contextMiddleware = (req, res, next) => {
  const requestId = req.headers["x-request-id"] || crypto.randomUUID();
  const correlationId = req.headers["x-correlation-id"] || requestId;
  const userId = req.user?.id || "anonymous";
  const timestamp = Date.now();

  const context = {
    requestId,
    correlationId,
    userId,
    timestamp,
  };

  requestContextStore.run(context, () => {
    res.setHeader("x-request-id", requestId);
    res.setHeader("x-correlation-id", correlationId);
    next();
  });
};

const getContext = () => {
  return requestContextStore.getStore() || {};
};

module.exports = {
  contextMiddleware,
  getContext,
};
