import "dotenv/config";
import http from "node:http";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import helmet from "helmet";
import { Server } from "socket.io";
import authRoutes from "./routes/auth";
import boardRoutes from "./routes/boards";
import { attachSocketHandlers } from "./socket";
import { errorHandler } from "./utils/errors";

const port = Number(process.env.PORT ?? 4000);
const origins = [
  ...(process.env.CORS_ORIGINS ?? process.env.CLIENT_URL ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean),
  ...(process.env.CODESPACE_NAME
    ? [
        `https://${process.env.CODESPACE_NAME}-5173.app.github.dev`,
        `https://${process.env.CODESPACE_NAME}-4173.app.github.dev`,
      ]
    : []),
].filter((origin, index, list) => list.indexOf(origin) === index);

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be configured with at least 32 characters");
}
if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI must be configured");

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: origins, credentials: true },
  allowRequest(request, callback) {
    const origin = request.headers.origin;
    callback(null, !origin || origins.includes(origin));
  },
});

app.set("io", io);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || origins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Origin is not allowed by CORS"));
  },
  credentials: true,
}));
app.use(express.json({ limit: "100kb" }));
app.use("/api", (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }
  const origin = req.get("origin");
  if (origin && origins.includes(origin)) {
    next();
    return;
  }
  res.status(403).json({ message: "A trusted request origin is required" });
});
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/auth", authRoutes);
app.use("/api/boards", boardRoutes);
app.use((_req, res) => res.status(404).json({ message: "Route not found" }));
app.use(errorHandler);

attachSocketHandlers(io);

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    httpServer.listen(port, "0.0.0.0", () => {
      console.info(`TaskFlow API listening on port ${port}`);
    });
  })
  .catch((error: unknown) => {
    console.error("Could not connect to MongoDB", error);
    process.exitCode = 1;
  });
