const express = require("express");
const router = express.Router();
const { getSettings, updateSettings } = require("../../controllers/settingsController");

router.get("/", getSettings);
router.post("/", updateSettings);

module.exports = router;
