import express from "express";
import { proxyHandler } from "./proxy.js";

const app = express();

// Main proxy route
app.get("/api/proxy", proxyHandler);

// Health check
app.get("/", (req, res) => {
  res.send("Nolan’s Proxy backend is running 🔥");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Proxy running on http://localhost:${PORT}`);
});
