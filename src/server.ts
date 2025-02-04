// src/server.ts
// @ts-nocheck
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { prisma } from "./database";
import { adjustPrice } from "./priceHandler";
import { PORT } from "./config";

const app = express();
app.use(express.json());

const manipulatedPrices = new Map<string, number>(); // In-memory price storage
const clients = new Map<string, Set<WebSocket>>(); // Track WebSocket clients

// WebSocket Server for Real-Time Prices
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const params = new URLSearchParams(req.url?.split("?")[1]);
  const symbol = params.get("symbol")?.toUpperCase();

  if (!symbol) {
    ws.close();
    return;
  }

  if (!clients.has(symbol)) {
    clients.set(symbol, new Set());
  }
  clients.get(symbol)?.add(ws);

  const intervalId = setInterval(async () => {
    const manipulatedPrice = await adjustPrice(symbol);
    if (manipulatedPrice) {
      manipulatedPrices.set(symbol, manipulatedPrice); // Store real-time price

      clients.get(symbol)?.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ symbol, price: manipulatedPrice }));
        }
      });
    }
  }, 1000);

  ws.on("close", () => {
    clients.get(symbol)?.delete(ws);
    if (clients.get(symbol)?.size === 0) {
      clearInterval(intervalId);
    }
  });
});

// POST Route: Place a New Trade
app.post("/api/orders", async (req, res) => {
  try {
    const {
      userId,
      symbolId,
      symbol,
      amount,
      direction,
      entryPrice,
      duration,
    } = req.body;

    if (!symbol || !amount || !direction || !duration) {
      return res.status(400).json({ error: "Invalid input" });
    }

    const dbUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!dbUser || dbUser.balance < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    const expiresAt = new Date(Date.now() + duration * 1000);

    // Atomic transaction: Create order + deduct balance
    const [order] = await prisma.$transaction(
      [
        prisma.order.create({
          data: {
            userId,
            symbolId,
            amount,
            direction,
            entryPrice,
            manipulatedEntryPrice: entryPrice,
            duration,
            expiresAt,
            payout: 0.8,
          },
        }),
        prisma.user.update({
          where: { id: userId },
          data: { balance: { decrement: amount } },
        }),
      ],
      { isolationLevel: "Serializable" }
    );

    // Trade Settlement after Expiry
    setTimeout(async () => {
      try {
        const realTimePrice = manipulatedPrices.get(symbol); // Use real-time price
        if (!realTimePrice) return;

        const isWin =
          direction === "up"
            ? realTimePrice > order.manipulatedEntryPrice
            : realTimePrice < order.manipulatedEntryPrice;

        const profitLoss = isWin ? amount * 0.8 : -amount;

        await prisma.$transaction([
          prisma.order.update({
            where: { id: order.id },
            data: {
              exitPrice: realTimePrice,
              manipulatedExitPrice: realTimePrice,
              outcome: isWin ? "win" : "loss",
              profitLoss,
            },
          }),
          isWin
            ? prisma.user.update({
                where: { id: userId },
                data: { balance: { increment: amount + profitLoss } },
              })
            : prisma.user.update({ where: { id: userId }, data: {} }),
        ]);
      } catch (error) {
        console.error("Error resolving trade:", error);
      }
    }, duration * 1000);

    res.status(201).json({ success: true, order });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server Error" });
  }
});

// Start the Server
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
