const express = require("express");
const router = express.Router();
const { getLogs } = require("../../controllers/logsController");

router.get("/logs", getLogs);

module.exports = router;
