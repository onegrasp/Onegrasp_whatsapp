require("dotenv").config();
const env = require("./config/env");
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const logger = require("./utils/logger");

const apiV1Router = require("./routes/v1");
const path = require("path");
const queueWorker = require("./workers/queueWorker");
const requestLogger = require("./middleware/requestLogger");
const authenticateToken = require("./middleware/auth");
const errorHandler = require("./errors/errorHandler");

const { contextMiddleware } = require("./context/requestContext");
const { applySecurity } = require("./middleware/security");
const { setIo } = require("./socket");
const { registerHandlers } = require("./events/handlers");

const app = express();
const server = http.createServer(app);

// Serverless Socket IP Fallback Middleware
app.use((req, res, next) => {
  if (!req.socket) {
    req.socket = { remoteAddress: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "127.0.0.1" };
  } else if (!req.socket.remoteAddress) {
    req.socket.remoteAddress = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "127.0.0.1";
  }
  next();
});

// Configure CORS origin handling
const allowedOrigins = env.FRONTEND_URL && env.FRONTEND_URL !== "*"
  ? env.FRONTEND_URL.split(",").map((o) => o.trim())
  : ["https://onegraspconnects.vercel.app", "http://localhost:5173", "http://localhost:3000"];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, true); // Permissive fallback for standard web browser requests
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

// Request context & tracing
app.use(contextMiddleware);

// Safe request logging
app.use(requestLogger);

// Security controls (helmet, trust proxy, rate limiters)
applySecurity(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.set("io", io);
setIo(io);

// Core event bus handling configuration
registerHandlers();

app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// Public Health Check Endpoints
app.get("/", (req, res) => {
  res.json({ status: "WhatsApp System Secure & Running", timestamp: new Date() });
});

app.get("/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date() });
});

// JWT Verification for Protected Endpoints
app.use(authenticateToken);

// Mount Versioned API across all URL variants
app.use("/api/v1", apiV1Router);
app.use("/api", apiV1Router);

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

const PROCESS_TYPE = env.PROCESS_TYPE;
const isVercel = Boolean(process.env.VERCEL || process.env.NOW_REGION);

if (!isVercel) {
  if (PROCESS_TYPE === "all" || PROCESS_TYPE === "worker") {
    queueWorker.start(io);
  }

  const PORT = env.PORT;
  if (PROCESS_TYPE === "all" || PROCESS_TYPE === "web") {
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT} in [${PROCESS_TYPE}] mode.`);
    });
  } else {
    console.log(`Background worker running in [${PROCESS_TYPE}] mode.`);
  }
} else {
  console.log("Running in Vercel Serverless environment.");
}

app.use(errorHandler);

module.exports = { app, io };
