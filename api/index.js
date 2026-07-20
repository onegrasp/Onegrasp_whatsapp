const { app } = require("../backend/src/server");

module.exports = (req, res) => {
  app(req, res);
};
