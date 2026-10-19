const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { uploadMedia } = require("../../controllers/mediaController");

const uploadsDir = path.join(__dirname, "../../../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `media-${uniqueSuffix}${ext}`);
  },
});

// Only accept media types WhatsApp actually supports. This also stops uploads
// of active content (HTML/SVG/scripts) that could be abused if ever served.
const ALLOWED_MIME = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "video/mp4", "video/3gpp",
  "audio/mpeg", "audio/ogg", "audio/amr",
  "application/pdf",
]);

const upload = multer({
  storage: storage,
  limits: { fileSize: 16 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) {
      return cb(null, true);
    }
    const err = new Error(`Unsupported file type: ${file.mimetype}`);
    err.statusCode = 400;
    err.category = "validation_error";
    return cb(err);
  },
});

router.post("/upload", upload.single("file"), uploadMedia);

module.exports = router;
