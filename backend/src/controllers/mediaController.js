const path = require("path");
const fs = require("fs");
const logger = require("../utils/logger");
const supabase = require("../config/supabase");

const uploadMedia = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: { code: "validation_error", message: "No file uploaded" } });
    }

    let publicUrl = "";
    let storagePath = "";
    let uploadedToCloud = false;

    if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
      try {
        const bucketName = "whatsapp-media";
        const { data: buckets } = await supabase.storage.listBuckets();
        const bucketExists = (buckets || []).some((b) => b.name === bucketName);

        if (!bucketExists) {
          logger.info(`Creating public Supabase Storage bucket: ${bucketName}...`);
          const { error: createBucketErr } = await supabase.storage.createBucket(bucketName, {
            public: true,
            fileSizeLimit: 16777216,
          });
          if (createBucketErr) throw createBucketErr;
        }

        const fileBuffer = fs.readFileSync(req.file.path);
        const fileName = `${Date.now()}-${path.basename(req.file.originalname)}`;
        storagePath = fileName;

        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from(bucketName)
          .upload(fileName, fileBuffer, {
            contentType: req.file.mimetype,
            upsert: true,
          });

        if (uploadErr) throw uploadErr;

        const { data: urlData } = supabase.storage
          .from(bucketName)
          .getPublicUrl(fileName);

        if (urlData && urlData.publicUrl) {
          publicUrl = urlData.publicUrl;
          uploadedToCloud = true;
          logger.info(`File uploaded to Supabase Storage bucket: ${bucketName}`, { publicUrl });

          try {
            fs.unlinkSync(req.file.path);
          } catch (unlinkErr) {
            logger.warn("Failed to delete local temporary upload file:", { error: unlinkErr });
          }
        }
      } catch (cloudErr) {
        logger.error("Supabase Storage upload failed. Falling back to local disk hosting.", { error: cloudErr });
      }
    }

    if (!uploadedToCloud) {
      let baseUrl = "";
      if (process.env.PUBLIC_URL) {
        baseUrl = process.env.PUBLIC_URL.replace(/\/+$/, "");
      } else if (process.env.STATUS_CALLBACK_URL) {
        try {
          const u = new URL(process.env.STATUS_CALLBACK_URL);
          baseUrl = u.origin;
        } catch (e) {
          // ignore
        }
      }

      if (!baseUrl) {
        const protocol = req.headers["x-forwarded-proto"] || req.protocol;
        const host = req.headers["x-forwarded-host"] || req.get("host");
        baseUrl = `${protocol}://${host}`;
      }

      publicUrl = `${baseUrl}/uploads/${req.file.filename}`;
      storagePath = req.file.path;
      logger.info(`File uploaded to local disk: ${req.file.filename}`, { publicUrl });
    }

    try {
      await supabase
        .from("media_assets")
        .insert([
          {
            filename: req.file.filename,
            original_name: req.file.originalname,
            url: publicUrl,
            mime_type: req.file.mimetype,
            size_bytes: req.file.size,
            storage_path: storagePath,
          },
        ]);
    } catch (dbErr) {
      logger.error("Failed to insert media asset tracking record into database:", { error: dbErr });
    }

    res.json({
      message: "Media uploaded successfully",
      filename: req.file.filename,
      mediaUrl: publicUrl,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  uploadMedia,
};
