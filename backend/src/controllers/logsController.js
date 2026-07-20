const logger = require("../utils/logger");

const getLogs = (req, res) => {
  const history = logger.getHistory();
  const { level, limit = 100 } = req.query;

  let filtered = [...history];

  if (level) {
    filtered = filtered.filter((log) => log.level === level.toUpperCase());
  }

  filtered.reverse();

  res.json({
    success: true,
    count: filtered.length,
    data: filtered.slice(0, parseInt(limit, 10)),
  });
};

module.exports = { getLogs };
