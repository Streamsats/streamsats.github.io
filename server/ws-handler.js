import { WebSocketServer } from "ws";
import { getState, setPlayersOnline, addSession, getSession, removeSession } from "./game-state.js";
import { getCurrentChallenge, getChallengeById, advanceChallenge } from "./challenge-loader.js";
import { createSlotInvoice, startPollingInvoice } from "./invoice-manager.js";
import { generateSessionToken, validateSessionToken, validateInteractionProof } from "./anti-cheat.js";
import { payWinner, } from "./payout.js";
import { renderDigitImage } from "./digit-renderer.js";

const clients = new Map(); // ws → { id, winnerAddress }

let broadcastFn = null;

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server });

  broadcastFn = (event, data) => {
    const msg = JSON.stringify({ event, data });
    for (const [ws] of clients) {
      if (ws.readyState === ws.OPEN) ws.send(msg);
    }
  };

  wss.on("connection", (ws) => {
    const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    clients.set(ws, { id: clientId, winnerAddress: null });
    setPlayersOnline(clients.size);

    // Send current game state to new client
    const challenge = getCurrentChallenge();
    const state = getState();
    send(ws, "game:state", {
      challengeId: challenge.id,
      title: challenge.title,
      type: challenge.type,
      prizePoolSats: state.prizePoolSats,
      playersOnline: clients.size,
      slotPriceSats: challenge.pricePerSlotSats
    });

    // Broadcast updated player count
    broadcastFn("game:state", {
      challengeId: challenge.id,
      title: challenge.title,
      type: challenge.type,
      prizePoolSats: state.prizePoolSats,
      playersOnline: clients.size,
      slotPriceSats: challenge.pricePerSlotSats
    });

    ws.on("message", (raw) => {
      try {
        const { event, data } = JSON.parse(raw);
        handleMessage(ws, event, data);
      } catch (err) {
        console.error("[ws] parse error:", err.message);
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      setPlayersOnline(clients.size);
      const ch = getCurrentChallenge();
      const st = getState();
      broadcastFn("game:state", {
        challengeId: ch.id,
        title: ch.title,
        type: ch.type,
        prizePoolSats: st.prizePoolSats,
        playersOnline: clients.size,
        slotPriceSats: ch.pricePerSlotSats
      });
    });

    ws.on("error", (err) => console.error("[ws] error:", err.message));
  });

  return wss;
}

function send(ws, event, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ event, data }));
  }
}

async function handleMessage(ws, event, data) {
  if (event === "payment:request") {
    await handlePaymentRequest(ws, data);
  } else if (event === "demo:request") {
    await handleDemoRequest(ws, data);
  } else if (event === "zone:reveal") {
    handleZoneReveal(ws, data);
  } else if (event === "answer:submit") {
    await handleAnswerSubmit(ws, data);
  }
}

async function handlePaymentRequest(ws, { challengeId, winnerAddress }) {
  // Store winner address for later payout
  const clientInfo = clients.get(ws);
  if (clientInfo && winnerAddress) {
    clientInfo.winnerAddress = winnerAddress;
  }

  const challenge = getCurrentChallenge();
  if (challenge.id !== challengeId) {
    send(ws, "error", { message: "Challenge ID mismatch — reload the page" });
    return;
  }

  // FREE_MODE: skip payment for testing
  if (process.env.FREE_MODE === "true") {
    const fakeHash = `free-${Date.now()}`;
    const { addToPool } = await import("./game-state.js");
    const poolTotal = addToPool(Math.floor(challenge.pricePerSlotSats * 0.9));
    onPaymentConfirmed(ws, challenge, fakeHash, challenge.pricePerSlotSats, poolTotal);
    return;
  }

  try {
    const invoiceData = await createSlotInvoice(challengeId, challenge.pricePerSlotSats);
    send(ws, "payment:invoice", {
      invoice: invoiceData.invoice,
      paymentHash: invoiceData.paymentHash,
      amountSats: invoiceData.amountSats,
      expiresAt: invoiceData.expiresAt
    });

    // Start polling for payment
    startPollingInvoice(invoiceData.paymentHash, ({ paymentHash, amountSats, poolTotal }) => {
      onPaymentConfirmed(ws, challenge, paymentHash, amountSats, poolTotal);
    });
  } catch (err) {
    console.error("[payment:request] error:", err.message);
    send(ws, "error", { message: "Could not create invoice: " + err.message });
  }
}

async function handleDemoRequest(ws, { challengeId }) {
  const challenge = getCurrentChallenge();
  if (challenge.id !== challengeId) {
    send(ws, "error", { message: "Challenge ID mismatch — reload the page" });
    return;
  }
  const fakeHash = `demo-${Date.now()}`;
  onPaymentConfirmed(ws, challenge, fakeHash, 0, getState().prizePoolSats, true);
}

function handleZoneReveal(ws, { zoneIndex, sessionToken }) {
  if (!sessionToken) {
    send(ws, "error", { message: "Missing sessionToken" });
    return;
  }

  const validation = validateSessionToken(sessionToken);
  if (!validation.valid) {
    send(ws, "error", { message: "Sesión inválida o expirada" });
    return;
  }

  const session = getSession(sessionToken);
  if (!session) {
    send(ws, "error", { message: "Sesión no encontrada" });
    return;
  }

  const idx = parseInt(zoneIndex, 10);
  if (isNaN(idx) || idx < 0 || idx >= session.code.length) {
    send(ws, "error", { message: "Índice de zona inválido" });
    return;
  }

  // Force sequential reveal
  if (idx !== session.revealedZones.size) {
    send(ws, "error", { message: "Debes revelar las zonas en orden" });
    return;
  }

  session.revealedZones.add(idx);
  const digit = session.code[idx];
  const seed = simpleHashServer(sessionToken + idx);
  const buffer = renderDigitImage(digit, seed);

  send(ws, "zone:revealed", { zoneIndex: idx, imageData: buffer.toString("base64") });
}

function simpleHashServer(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function generateRandomCode(digits) {
  let code = "";
  for (let i = 0; i < digits; i++) code += Math.floor(Math.random() * 10);
  return code;
}

function onPaymentConfirmed(ws, challenge, paymentHash, amountSats, poolTotal, isDemo = false) {
  const now = Date.now();
  const slotExpiresAt = now + challenge.slotDurationSeconds * 1000;
  const answerDeadlineAt = slotExpiresAt;

  const sessionCode = generateRandomCode(challenge.config.digits);
  const sessionToken = generateSessionToken(paymentHash, challenge.id, slotExpiresAt, answerDeadlineAt);
  addSession(sessionToken, { challengeId: challenge.id, paymentHash, slotExpiresAt, answerDeadlineAt, isDemo, code: sessionCode });

  // Broadcast pool update to all
  broadcastFn("pool:updated", { prizePoolSats: poolTotal, delta: amountSats });

  // Confirm payment to payer
  send(ws, "payment:confirmed", { sessionToken, slotExpiresAt });

  // Send hint start to payer
  send(ws, "hint:start", {
    slotDurationSeconds: challenge.slotDurationSeconds,
    interactionType: challenge.config.interactionRequired,
    sessionToken,
    challengeConfig: {
      type: challenge.type,
      seed: challenge.config.seed,
      colors: challenge.config.colors,
      sequence: challenge.config.sequence,
      sequenceLength: challenge.config.sequenceLength,
      noiseDensity: challenge.config.noiseDensity,
      flashCount: challenge.config.flashCount,
      flashDurationMs: challenge.config.flashDurationMs,
      digits: challenge.config.digits
    }
  });

  // Expire session after window
  setTimeout(() => {
    const session = getSession(sessionToken);
    if (session) {
      removeSession(sessionToken);
      send(ws, "hint:expired", { reason: "timeout" });
    }
  }, challenge.slotDurationSeconds * 1000);
}

async function handleAnswerSubmit(ws, { challengeId, answer, sessionToken, interactionProof, winnerAddress }) {
  const validation = validateSessionToken(sessionToken);
  if (!validation.valid) {
    send(ws, "submission:result", { correct: false, message: "Sesión inválida o expirada: " + validation.reason });
    return;
  }

  const challenge = getChallengeById(challengeId);
  if (!challenge) {
    send(ws, "submission:result", { correct: false, message: "Reto no encontrado" });
    return;
  }

  // Validate interaction proof
  const proofValid = validateInteractionProof(interactionProof, challenge, sessionToken);
  if (!proofValid) {
    send(ws, "submission:result", { correct: false, message: "Proof de interacción inválido — ¡haz clic en el juego!" });
    return;
  }

  // Check answer against this session's unique code
  const session = getSession(sessionToken);
  if (!session || answer.trim() !== session.code) {
    send(ws, "submission:result", { correct: false, message: "Respuesta incorrecta. ¡Intentá de nuevo!" });
    return;
  }

  // WINNER!
  removeSession(sessionToken);

  // Demo mode: show win but no payout
  if (session?.isDemo) {
    send(ws, "demo:win", { message: "¡Correcto! En modo real ganarías sats. ¿Juegas con dinero real?" });
    return;
  }

  const state = getState();
  const prizePoolSats = state.prizePoolSats;
  const { resetPool } = await import("./game-state.js");
  resetPool();

  // Get winner address
  const clientInfo = clients.get(ws);
  const lnAddress = winnerAddress || clientInfo?.winnerAddress;

  send(ws, "submission:result", { correct: true, message: `¡Ganaste ${prizePoolSats} sats!` });

  // Pay winner
  let paidSats = 0;
  if (lnAddress) {
    const payResult = await payWinner(lnAddress, prizePoolSats);
    paidSats = payResult.payoutSats || 0;
  } else {
    console.log("⚠️  Ganador sin Lightning Address — no se puede pagar automáticamente");
    paidSats = prizePoolSats;
  }

  // Advance to next challenge
  const nextChallenge = advanceChallenge();

  // Broadcast win to all
  broadcastFn("challenge:solved", {
    prizePoolSats,
    paidSats,
    nextChallengeIn: 5
  });

  // Broadcast new challenge after 5s
  setTimeout(() => {
    broadcastFn("challenge:new", {
      challengeId: nextChallenge.id,
      title: nextChallenge.title,
      type: nextChallenge.type,
      prizePoolSats: 0,
      slotPriceSats: nextChallenge.pricePerSlotSats
    });
  }, 5000);
}

export function broadcast(event, data) {
  if (broadcastFn) broadcastFn(event, data);
}
