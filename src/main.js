import { connect, on, send } from "./ws-client.js";
import { updateGameState, animatePool, setStatus, showSection, showVictoryScreen, startSlotTimer } from "./game-ui.js";
import { showInvoice, hideInvoice, copyInvoice } from "./payment-ui.js";
import { generateProof, getEventCount } from "./anti-cheat-client.js";
import { renderHiddenCode } from "./challenge-renderers/hidden-code.js";

let currentSessionToken = null;
let currentChallengeId = null;
let currentChallengeType = null;
let currentChallengeConfig = null;
let rendererCleanup = null;
let slotTimer = null;

// WebSocket events
on("ws:connected", () => {
  setStatus("Conectado al servidor ⚡", "success");
});

on("ws:disconnected", () => {
  setStatus("Reconectando...", "warning");
});

on("game:state", (data) => {
  updateGameState(data);
  currentChallengeId = data.challengeId;
  if (!currentSessionToken) showSection("lobby-section");
});

on("pool:updated", ({ prizePoolSats }) => {
  animatePool(prizePoolSats);
});

on("challenge:new", (data) => {
  currentChallengeId = data.challengeId;
  currentSessionToken = null;
  currentChallengeConfig = null;
  if (rendererCleanup) { rendererCleanup(); rendererCleanup = null; }
  updateGameState(data);
  hideInvoice();
  showSection("lobby-section");
  setStatus(`Nuevo reto: ${data.title}`, "info");
});

on("challenge:solved", ({ prizePoolSats, paidSats, nextChallengeIn }) => {
  showVictoryScreen(paidSats, nextChallengeIn);
  animatePool(0);
  if (rendererCleanup) { rendererCleanup(); rendererCleanup = null; }
  currentSessionToken = null;
});

on("payment:invoice", (data) => {
  setStatus("Pagá el invoice para entrar", "info");
  showInvoice(data);
});

on("payment:confirmed", ({ sessionToken, slotExpiresAt }) => {
  currentSessionToken = sessionToken;
  hideInvoice();
  setStatus("¡Pago confirmado! Observá la pista...", "success");
});

on("hint:start", ({ slotDurationSeconds, interactionType, sessionToken, challengeConfig }) => {
  currentChallengeConfig = challengeConfig;
  currentChallengeType = challengeConfig.type;
  showSection("challenge-section");
  setStatus(`¡Pista activa! Interactuá para revelarla`, "success");

  const canvas = document.getElementById("challenge-canvas");
  if (!canvas) return;

  if (rendererCleanup) { rendererCleanup(); rendererCleanup = null; }

  const onAnswer = (answer) => submitAnswer(answer);

  if (challengeConfig.type === "hidden-code") {
    rendererCleanup = renderHiddenCode(canvas, challengeConfig, sessionToken, onAnswer);
  }

  const slotExpiresAt = Date.now() + slotDurationSeconds * 1000;
  slotTimer = startSlotTimer(slotExpiresAt, () => {
    setStatus("Tiempo de pista agotado — podés seguir respondiendo", "warning");
  });
});

on("hint:expired", () => {
  setStatus("Pista expirada", "warning");
  if (rendererCleanup) { rendererCleanup(); rendererCleanup = null; }
});

on("submission:result", ({ correct, message }) => {
  if (correct) {
    setStatus("¡GANASTE! " + message, "success");
  } else {
    setStatus(message, "error");
  }
});

on("error", ({ message }) => {
  setStatus("Error: " + message, "error");
});

// DOM Actions
window.requestSlot = function() {
  const address = document.getElementById("winner-address")?.value?.trim();
  if (!currentChallengeId) {
    setStatus("Esperando estado del servidor...", "warning");
    return;
  }
  setStatus("Solicitando invoice...", "info");
  send("payment:request", { challengeId: currentChallengeId, winnerAddress: address });
};

window.submitAnswerManual = function() {
  const input = document.getElementById("answer-input");
  if (!input) return;
  submitAnswer(input.value.trim());
};

window.copyInvoice = copyInvoice;

function submitAnswer(answer) {
  if (!currentSessionToken) {
    setStatus("No tenés sesión activa — pagá primero", "warning");
    return;
  }
  const proof = generateProof();
  const address = document.getElementById("winner-address")?.value?.trim();
  setStatus("Enviando respuesta...", "info");
  send("answer:submit", {
    challengeId: currentChallengeId,
    answer,
    sessionToken: currentSessionToken,
    interactionProof: proof,
    winnerAddress: address
  });
}

// Start
connect();
