// src/priceHandler.ts
// @ts-nocheck
import axios from "axios";
import { prisma } from "./database.js";
import { BINANCE_API } from "./config.js";

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches the latest price from Binance for the given symbol with retry mechanism.
 */
export async function fetchBinancePrice(
  symbol: string,
  retryCount = 0
): Promise<number | null> {
  try {
    const response = await axios.get(`${BINANCE_API}${symbol.toUpperCase()}`, {
      timeout: 5000, // 5 second timeout
      headers: {
        "User-Agent": "Mozilla/5.0", // Add user agent to prevent some blocks
      },
    });
    return parseFloat(response.data.price);
  } catch (error) {
    console.error(`Error fetching Binance price for ${symbol}:`, {
      attempt: retryCount + 1,
      error: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });

    if (retryCount < MAX_RETRIES) {
      await delay(RETRY_DELAY);
      return fetchBinancePrice(symbol, retryCount + 1);
    }

    // If all retries failed, return null
    return null;
  }
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

    const binancePrice = await fetchBinancePrice(symbol);
    if (!binancePrice) {
      console.error(`Could not fetch price for symbol: ${symbol}`);
      return symbolData.manipulatedPrice; // Return last known price if fetch fails
    }

    const { upValue, downValue } = await getOrderTotals(symbolData.id);
    let manipulatedPrice = binancePrice;

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
        currentPrice: binancePrice,
      },
    });

    return manipulatedPrice;
  } catch (error) {
    console.error(`Error in adjustPrice for ${symbol}:`, error);
    return null;
  }
}
