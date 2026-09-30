const { app } = require("../backend/src/server");

module.exports = (req, res) => {
  try {
    // If Vercel rewrote the URL, normalize req.url if x-matched-path or req.url points to api/index.js
    if (req.url === "/api/index.js" || req.url === "/api/index" || req.url === "/api/") {
      const targetPath = req.headers["x-matched-path"] || req.headers["x-override-path"];
      if (targetPath) {
        req.url = targetPath;
      }
    }
    app(req, res);
  } catch (err) {
    console.error("Vercel Serverless Function Uncaught Error:", err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      success: false,
      error: {
        code: "serverless_error",
        message: err.message || "Internal server error"
      }
    }));
  }
};
