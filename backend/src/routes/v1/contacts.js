const express = require("express");
const router = express.Router();
const multer = require("multer");
const { uploadContacts, getContacts, getContactSets, assignSet, removeSet, createSingle, deleteBulk, updateLabel, deleteContact, exportContacts, toggleImportant, updateConsent } = require("../../controllers/contactController");

const AppError = require("../../errors/AppError");
const { MAX_CONTACT_FILE_MB } = require("../../utils/csvParser");

// Contact files are parsed in memory, so their size is capped.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CONTACT_FILE_MB * 1024 * 1024, files: 1, fields: 10, fieldSize: 4096 },
});

const uploadContactFile = (req, res, next) =>
  upload.single("file")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return next(new AppError(`This file is larger than ${MAX_CONTACT_FILE_MB} MB. Split it into smaller files and import them one at a time.`, 413, "file_too_large"));
    }
    return next(new AppError(`The upload was rejected: ${err.message}`, 400, "validation_error"));
  });

router.post("/upload", uploadContactFile, uploadContacts);
router.get("/", getContacts);
router.post("/", createSingle);
router.post("/bulk-delete", deleteBulk);
router.get("/sets", getContactSets);
router.post("/sets/assign", assignSet);
router.post("/sets/remove", removeSet);
router.post("/consent", updateConsent);
router.patch("/:id/label", updateLabel);
router.delete("/:id", deleteContact);
router.get("/export", exportContacts);
router.patch("/important/:phone", toggleImportant);

module.exports = router;
