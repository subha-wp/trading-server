// src/config.ts
import dotenv from "dotenv";

dotenv.config();

export const PORT = process.env.PORT || 8080;
export const DATABASE_URL = process.env.DATABASE_URL;
export const BINANCE_API =
  process.env.BINANCE_API ||
  "https://api.binance.com/api/v3/ticker/price?symbol=";
