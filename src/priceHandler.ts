// src/priceHandler.ts
import WebSocket from "ws";
import { prisma } from "./database.js";
import { BINANCE_WS_URL, BINANCE_CONFIG } from "./config.js";

// ✅ Cached prices for real-time updates
const priceCache = new Map<string, number>();

/**
 * ✅ Get the latest Binance price from cache
 */
export function getCurrentPrice(symbol: string): number | null {
  return priceCache.get(symbol) || null;
}

/**
 * ✅ Get total UP and DOWN order values for a symbol (only active trades)
 */
export async function getOrderTotals(symbolId: number) {
  const orders = await prisma.order.groupBy({
    by: ["direction"],
    where: {
      symbolId,
      outcome: null, // ✅ Only active trades
    },
    _sum: { amount: true },
  });

  return {
    upValue: orders.find((o) => o.direction === "up")?._sum.amount || 0,
    downValue: orders.find((o) => o.direction === "down")?._sum.amount || 0,
  };
}

/**
 * ✅ Adjusts price based on order volume (Ensures 60-70% platform profitability)
 */
export async function adjustPrice(symbol: string) {
  try {
    const currentPrice = getCurrentPrice(symbol);
    if (!currentPrice) {
      console.error(`No price available for symbol: ${symbol}`);
      return null;
    }

    const symbolData = await prisma.symbol.findUnique({
      where: { name: symbol },
    });

    if (!symbolData) {
      console.error(`Symbol not found: ${symbol}`);
      return null;
    }

    const { upValue, downValue } = await getOrderTotals(symbolData.id);
    let manipulatedPrice = currentPrice;

    const totalValue = upValue + downValue;

    if (totalValue > 0) {
      const upRatio = upValue / totalValue;
      const downRatio = downValue / totalValue;

      // ✅ If too many DOWN trades, adjust price slightly UP
      if (downRatio > 0.6) {
        manipulatedPrice *= 1.002;
      }
      // ✅ If too many UP trades, adjust price slightly DOWN
      else if (upRatio > 0.6) {
        manipulatedPrice *= 0.998;
      }

      // ✅ Random variation (between -0.025% to +0.025%) to avoid obvious manipulation
      const randomFactor = Math.random() * 0.0005 + 0.99975;
      manipulatedPrice *= randomFactor;
    }

    // ✅ Update manipulated price in DB
    await prisma.symbol.update({
      where: { name: symbol },
      data: { manipulatedPrice, currentPrice },
    });

    return manipulatedPrice;
  } catch (error) {
    console.error(`Error in adjustPrice for ${symbol}:`, error);
    return null;
  }
}

/**
 * ✅ Initialize WebSocket connection to Binance
 */
function initBinanceWebSocket() {
  let binanceWs = new WebSocket(BINANCE_WS_URL);

  binanceWs.on("open", () => {
    console.log("Connected to Binance WebSocket");
  });

  binanceWs.on("message", (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());

      // ✅ Binance ticker updates
      if (message.e === "24hrTicker") {
        const symbol = message.s;
        const price = parseFloat(message.c); // ✅ Live price
        priceCache.set(symbol, price);
      }
    } catch (error) {
      console.error("Error processing Binance message:", error);
    }
  });

  binanceWs.on("close", () => {
    console.log("Binance WebSocket disconnected. Reconnecting...");
    setTimeout(initBinanceWebSocket, BINANCE_CONFIG.RECONNECT_DELAY);
  });

  binanceWs.on("error", (error) => {
    console.error("Binance WebSocket error:", error);
  });
}

// ✅ Start WebSocket on launch
initBinanceWebSocket();
