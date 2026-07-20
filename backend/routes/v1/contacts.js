const express = require("express");
const router = express.Router();
const multer = require("multer");
const { uploadContacts, getContacts, updateLabel, deleteContact, exportContacts, toggleImportant } = require("../../controllers/contactController");

const upload = multer({ storage: multer.memoryStorage() });

router.post("/upload", upload.single("file"), uploadContacts);
router.get("/", getContacts);
router.patch("/:id/label", updateLabel);
router.delete("/:id", deleteContact);
router.get("/export", exportContacts);
router.patch("/important/:phone", toggleImportant);

module.exports = router;
