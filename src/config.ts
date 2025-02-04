// src/config.ts
import dotenv from "dotenv";

dotenv.config();

export const PORT = process.env.PORT || 8080;
export const DATABASE_URL = process.env.DATABASE_URL;

// Use testnet WebSocket in production
export const BINANCE_WS_URL =
  process.env.NODE_ENV === "production"
    ? "wss://testnet.binance.vision/ws"
    : "wss://stream.binance.com:9443/ws";

// Binance WebSocket configuration
export const BINANCE_CONFIG = {
  RECONNECT_DELAY: 5000,
  MAX_RECONNECT_ATTEMPTS: 5,
  PING_INTERVAL: 30000, // Send ping every 30 seconds
};
