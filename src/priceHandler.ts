// src/priceHandler.ts
// @ts-nocheck
import axios from "axios";
import { prisma } from "./database.js";
import { BINANCE_API } from "./config.js";

/**
 * Fetches the latest price from Binance for the given symbol.
 */
export async function fetchBinancePrice(symbol: string) {
  try {
    const response = await axios.get(`${BINANCE_API}${symbol.toUpperCase()}`);
    return parseFloat(response.data.price);
  } catch (error) {
    console.error(`Error fetching Binance price for ${symbol}`, error);
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
      outcome: null, // ✅ Only consider open trades
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
  const symbolData = await prisma.symbol.findUnique({
    where: { binanceSymbol: symbol },
  });
  if (!symbolData) return null;

  const binancePrice = await fetchBinancePrice(symbol);
  if (!binancePrice) return null;

  const { upValue, downValue } = await getOrderTotals(symbolData.id);
  let manipulatedPrice = binancePrice; // Start with Binance's price

  const totalValue = upValue + downValue;

  if (totalValue > 0) {
    const upRatio = upValue / totalValue;
    const downRatio = downValue / totalValue;

    if (upRatio > 0.6) {
      manipulatedPrice *= 0.998; // Slightly decrease if UP orders dominate
    } else if (downRatio > 0.6) {
      manipulatedPrice *= 1.002; // Slightly increase if DOWN orders dominate
    }
  }

  await prisma.symbol.update({
    where: { binanceSymbol: symbol },
    data: { manipulatedPrice },
  });

  return manipulatedPrice;
}
