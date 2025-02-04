// src/priceHandler.ts
// @ts-nocheck
import WebSocket from "ws";
import { prisma } from "./database.js";
import { BINANCE_WS_URL, BINANCE_CONFIG } from "./config.js";

// Price cache
const priceCache = new Map<string, number>();
let binanceWs: WebSocket | null = null;
let pingInterval: NodeJS.Timeout;
let reconnectAttempts = 0;
const activeSymbols = new Set<string>();

/**
 * Initialize WebSocket connection to Binance
 */
function initBinanceWebSocket() {
  if (binanceWs) {
    binanceWs.terminate();
  }

  binanceWs = new WebSocket(BINANCE_WS_URL);

  binanceWs.on("open", () => {
    console.log("Connected to Binance WebSocket");
    reconnectAttempts = 0;

    // Subscribe to all active symbols
    if (activeSymbols.size > 0) {
      const subscribeMsg = {
        method: "SUBSCRIBE",
        params: Array.from(activeSymbols).map(
          (symbol) => `${symbol.toLowerCase()}@ticker`
        ),
        id: Date.now(),
      };
      binanceWs.send(JSON.stringify(subscribeMsg));
    }

    // Setup ping interval
    pingInterval = setInterval(() => {
      if (binanceWs?.readyState === WebSocket.OPEN) {
        binanceWs.ping();
      }
    }, BINANCE_CONFIG.PING_INTERVAL);
  });

  binanceWs.on("message", (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());

      // Handle ticker updates
      if (message.e === "24hrTicker") {
        const symbol = message.s;
        const price = parseFloat(message.c); // Current price
        priceCache.set(symbol, price);
      }
    } catch (error) {
      console.error("Error processing WebSocket message:", error);
    }
  });

  binanceWs.on("close", () => {
    console.log("Binance WebSocket connection closed");
    clearInterval(pingInterval);
    handleReconnect();
  });

  binanceWs.on("error", (error) => {
    console.error("Binance WebSocket error:", error);
    binanceWs?.terminate();
  });
}

/**
 * Handle WebSocket reconnection with exponential backoff
 */
function handleReconnect() {
  if (reconnectAttempts >= BINANCE_CONFIG.MAX_RECONNECT_ATTEMPTS) {
    console.error("Max reconnection attempts reached");
    return;
  }

  const delay = BINANCE_CONFIG.RECONNECT_DELAY * Math.pow(2, reconnectAttempts);
  reconnectAttempts++;

  console.log(`Reconnecting in ${delay}ms... (Attempt ${reconnectAttempts})`);
  setTimeout(initBinanceWebSocket, delay);
}

/**
 * Subscribe to a symbol's price updates
 */
export function subscribeToSymbol(symbol: string) {
  if (!activeSymbols.has(symbol)) {
    activeSymbols.add(symbol);

    if (binanceWs?.readyState === WebSocket.OPEN) {
      const subscribeMsg = {
        method: "SUBSCRIBE",
        params: [`${symbol.toLowerCase()}@ticker`],
        id: Date.now(),
      };
      binanceWs.send(JSON.stringify(subscribeMsg));
    }
  }
}

/**
 * Get the current price for a symbol
 */
export function getCurrentPrice(symbol: string): number | null {
  return priceCache.get(symbol) || null;
}

/**
 * Retrieves the total UP and DOWN order values for a symbol.
 */
export async function getOrderTotals(symbolId: number) {
  const orders = await prisma.order.groupBy({
    by: ["direction"],
    where: {
      symbolId,
      outcome: null,
    },
    _sum: { amount: true },
  });

  return {
    upValue: orders.find((o) => o.direction === "up")?._sum.amount || 0,
    downValue: orders.find((o) => o.direction === "down")?._sum.amount || 0,
  };
}

/**
 * Adjusts the price based on order value manipulation logic.
 */
export async function adjustPrice(symbol: string) {
  try {
    const symbolData = await prisma.symbol.findUnique({
      where: { name: symbol },
    });

    if (!symbolData) {
      console.error(`Symbol not found: ${symbol}`);
      return null;
    }

    const currentPrice = getCurrentPrice(symbol);
    if (!currentPrice) {
      console.error(`No price available for symbol: ${symbol}`);
      return symbolData.manipulatedPrice;
    }

    const { upValue, downValue } = await getOrderTotals(symbolData.id);
    let manipulatedPrice = currentPrice;

    const totalValue = upValue + downValue;

    if (totalValue > 0) {
      const upRatio = upValue / totalValue;
      const downRatio = downValue / totalValue;

      if (upRatio > 0.6) {
        manipulatedPrice *= 0.998;
      } else if (downRatio > 0.6) {
        manipulatedPrice *= 1.002;
      }
    }

    await prisma.symbol.update({
      where: { name: symbol },
      data: {
        manipulatedPrice,
        currentPrice,
      },
    });

    return manipulatedPrice;
  } catch (error) {
    console.error(`Error in adjustPrice for ${symbol}:`, error);
    return null;
  }
}

// Initialize WebSocket connection
initBinanceWebSocket();
