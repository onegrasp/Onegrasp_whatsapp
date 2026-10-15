const express = require("express");
const router = express.Router();
const multer = require("multer");
const { uploadContacts, getContacts, getContactSets, assignSet, removeSet, createSingle, deleteBulk, updateLabel, deleteContact, exportContacts, toggleImportant } = require("../../controllers/contactController");

const upload = multer({ storage: multer.memoryStorage() });

router.post("/upload", upload.single("file"), uploadContacts);
router.get("/", getContacts);
router.post("/", createSingle);
router.post("/bulk-delete", deleteBulk);
router.get("/sets", getContactSets);
router.post("/sets/assign", assignSet);
router.post("/sets/remove", removeSet);
router.patch("/:id/label", updateLabel);
router.delete("/:id", deleteContact);
router.get("/export", exportContacts);
router.patch("/important/:phone", toggleImportant);

module.exports = router;
