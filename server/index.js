import { createServer } from "http";
import express from "express";
import dotenv from "dotenv";
import { getState, addToPool } from "./game-state.js";
import { getCurrentChallenge } from "./challenge-loader.js";
import { setupWebSocket, broadcast } from "./ws-handler.js";
import { testNWCConnection } from "./nwc.js";

dotenv.config();

const PORT = parseInt(process.env.PORT || process.env.SERVER_PORT || "3001");

const app = express();
app.use(express.json());

// CORS for Vite dev server
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// REST API
app.get("/api/state", (req, res) => {
  const state = getState();
  const challenge = getCurrentChallenge();
  res.json({
    challengeId: challenge.id,
    title: challenge.title,
    type: challenge.type,
    prizePoolSats: state.prizePoolSats,
    playersOnline: state.playersOnline,
    slotPriceSats: challenge.pricePerSlotSats
  });
});

app.get("/api/challenge", (req, res) => {
  const challenge = getCurrentChallenge();
  // Don't expose answerHash or config.code to client
  const safe = {
    id: challenge.id,
    type: challenge.type,
    title: challenge.title,
    pricePerSlotSats: challenge.pricePerSlotSats,
    slotDurationSeconds: challenge.slotDurationSeconds,
    config: {
      seed: challenge.config.seed,
      colors: challenge.config.colors,
      sequenceLength: challenge.config.sequenceLength,
      noiseDensity: challenge.config.noiseDensity,
      flashCount: challenge.config.flashCount,
      flashDurationMs: challenge.config.flashDurationMs,
      digits: challenge.config.digits,
      interactionRequired: challenge.config.interactionRequired,
      requiredClicks: challenge.config.requiredClicks,
      answerWindowSeconds: challenge.config.answerWindowSeconds
    }
  };
  res.json(safe);
});

app.get("/api/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

// Admin: add sats to prize pool without payment
app.post("/api/admin/add-to-pool", (req, res) => {
  const token = process.env.ADMIN_TOKEN;
  if (!token || req.headers["authorization"] !== `Bearer ${token}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const sats = parseInt(req.body?.sats);
  if (!sats || sats <= 0 || sats > 10_000_000) {
    return res.status(400).json({ error: "Invalid sats amount (1 – 10,000,000)" });
  }
  const poolTotal = addToPool(sats);
  broadcast("pool:updated", { prizePoolSats: poolTotal, delta: sats });
  console.log(`[admin] Added ${sats} sats to pool → total ${poolTotal}`);
  res.json({ ok: true, added: sats, prizePoolSats: poolTotal });
});

// Create HTTP server and attach WebSocket
const server = createServer(app);
setupWebSocket(server);

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`❌ Puerto ${PORT} ya en uso. Matá el proceso anterior o cambiá SERVER_PORT en .env`);
    process.exit(1);
  } else {
    throw err;
  }
});

server.listen(PORT, async () => {
  console.log(`\n⚡ StreamSats server running on http://localhost:${PORT} [build: ${new Date().toISOString()}]`);
  console.log(`   REST API: http://localhost:${PORT}/api/state`);
  console.log(`   WebSocket: ws://localhost:${PORT}\n`);

  // Test NWC connection
  const nwcResult = await testNWCConnection();
  if (nwcResult.ok) {
    console.log(`✅ NWC connected: ${nwcResult.alias || "wallet"}`);
  } else {
    console.log(`⚠️  NWC: ${nwcResult.reason} (running in mock mode)`);
  }

  const challenge = getCurrentChallenge();
  console.log(`\n🎮 Current challenge: ${challenge.title} (${challenge.id})`);
  console.log(`   Price: ${challenge.pricePerSlotSats} sats/slot\n`);
});
