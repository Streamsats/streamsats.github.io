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
let lobbyRedirectTimer = null;
let iWon = false;

// WebSocket events
on("ws:connected", () => {
  setStatus("Conectado al servidor ⚡", "success");
});

on("ws:disconnected", () => {
  setStatus("Reconectando...", "warning");
});

function updateMobilePool(sats) {
  const el = document.getElementById("mobile-prize-pool");
  if (el) el.textContent = sats.toLocaleString();
}

on("game:state", (data) => {
  updateGameState(data);
  updateMobilePool(data.prizePoolSats);
  currentChallengeId = data.challengeId;
  if (!currentSessionToken) showSection("lobby-section");
});

on("pool:updated", ({ prizePoolSats }) => {
  animatePool(prizePoolSats);
  updateMobilePool(prizePoolSats);
});

on("challenge:new", (data) => {
  currentChallengeId = data.challengeId;
  currentSessionToken = null;
  currentChallengeConfig = null;
  if (rendererCleanup) { rendererCleanup(); rendererCleanup = null; }
  if (slotTimer) { clearInterval(slotTimer); slotTimer = null; }
  updateGameState(data);
  updateMobilePool(data.prizePoolSats);
  hideInvoice();
  showSection("lobby-section");
  setStatus(`Nuevo reto: ${data.title}`, "info");
});

on("challenge:solved", ({ paidSats, nextChallengeIn }) => {
  animatePool(0);
  if (rendererCleanup) { rendererCleanup(); rendererCleanup = null; }
  if (slotTimer) { clearInterval(slotTimer); slotTimer = null; }
  currentSessionToken = null;
  if (iWon) {
    iWon = false;
    showVictoryScreen(paidSats, nextChallengeIn);
  } else {
    showOtherWonScreen(paidSats, nextChallengeIn);
  }
});

on("payment:invoice", (data) => {
  setStatus("Paga el invoice para entrar", "info");
  showInvoice(data);
});

on("payment:confirmed", ({ sessionToken, slotExpiresAt }) => {
  currentSessionToken = sessionToken;
  hideInvoice();
  setStatus("¡Pago confirmado! Observá la pista...", "success");
});

on("hint:start", ({ slotDurationSeconds, interactionType, sessionToken, challengeConfig }) => {
  if (lobbyRedirectTimer) { clearTimeout(lobbyRedirectTimer); lobbyRedirectTimer = null; }
  currentChallengeConfig = challengeConfig;
  currentChallengeType = challengeConfig.type;
  showSection("challenge-section");
  setStatus(`¡Pista activa! Interactúa para revelarla`, "success");
  showChallengeInstructions(challengeConfig.type);

  const canvas = document.getElementById("challenge-canvas");
  if (!canvas) return;

  if (rendererCleanup) { rendererCleanup(); rendererCleanup = null; }

  const onAnswer = (answer) => submitAnswer(answer);

  if (challengeConfig.type === "hidden-code") {
    rendererCleanup = renderHiddenCode(canvas, challengeConfig, sessionToken, onAnswer);
  }

  const slotExpiresAt = Date.now() + slotDurationSeconds * 1000;
  if (slotTimer) { clearInterval(slotTimer); slotTimer = null; }
  slotTimer = startSlotTimer(slotExpiresAt, () => {
    if (rendererCleanup) { rendererCleanup(); rendererCleanup = null; }
    currentSessionToken = null;
    setStatus("¡Tiempo agotado! No has encontrado el código a tiempo.", "error");
    lobbyRedirectTimer = setTimeout(() => showSection("lobby-section"), 3000);
  });
});

on("hint:expired", () => {
  setStatus("Pista expirada", "warning");
  if (rendererCleanup) { rendererCleanup(); rendererCleanup = null; }
});

on("submission:result", ({ correct, message }) => {
  if (correct) {
    iWon = true;
    if (slotTimer) { clearInterval(slotTimer); slotTimer = null; }
  }
  showResultPopup(correct, message);
});

on("demo:win", ({ message }) => {
  if (rendererCleanup) { rendererCleanup(); rendererCleanup = null; }
  if (slotTimer) { clearInterval(slotTimer); slotTimer = null; }
  currentSessionToken = null;
  const screen = document.getElementById("demo-win-screen");
  if (screen) screen.style.display = "flex";
  setStatus(message, "success");
});

on("error", ({ message }) => {
  setStatus("Error: " + message, "error");
});

// DOM Actions
window.requestSlot = function() {
  const address = document.getElementById("winner-address")?.value?.trim();
  if (!address || !address.includes("@")) {
    setStatus("Ingresa tu Lightning Address para poder recibir el premio", "error");
    document.getElementById("winner-address")?.focus();
    return;
  }
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

window.requestDemo = function() {
  if (!currentChallengeId) {
    setStatus("Esperando estado del servidor...", "warning");
    return;
  }
  setStatus("Iniciando demo...", "info");
  send("demo:request", { challengeId: currentChallengeId });
};

window.playForReal = function() {
  window.closeDemoWin();
  showSection("lobby-section");
  setStatus("Ingresa tu Lightning Address y paga para competir por sats reales", "info");
};

window.closeDemoWin = function() {
  const screen = document.getElementById("demo-win-screen");
  if (screen) screen.style.display = "none";
  showSection("lobby-section");
};

function submitAnswer(answer) {
  if (!currentSessionToken) {
    setStatus("No tienes sesión activa — paga primero", "warning");
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

function showOtherWonScreen(paidSats, nextChallengeIn) {
  const screen = document.getElementById("other-won-screen");
  if (!screen) return;
  document.getElementById("other-won-amount").textContent = `El ganador se llevó ${paidSats.toLocaleString()} sats`;
  screen.style.display = "flex";
  let countdown = nextChallengeIn;
  const cdEl = document.getElementById("other-won-countdown");
  const t = setInterval(() => {
    countdown--;
    if (cdEl) cdEl.textContent = countdown;
    if (countdown <= 0) {
      clearInterval(t);
      screen.style.display = "none";
    }
  }, 1000);
}

function showResultPopup(correct, message) {
  const popup = document.getElementById("result-popup");
  const box = document.getElementById("result-popup-box");
  if (!popup) return;
  document.getElementById("result-popup-icon").textContent = correct ? "🏆" : "❌";
  document.getElementById("result-popup-title").textContent = correct ? "¡Respuesta correcta!" : "Respuesta incorrecta";
  document.getElementById("result-popup-title").style.color = correct ? "#00ff9d" : "#ef4444";
  document.getElementById("result-popup-msg").textContent = message;
  box.style.borderColor = correct ? "rgba(0,255,157,0.3)" : "rgba(239,68,68,0.3)";
  popup.style.display = "flex";
  if (!correct) setTimeout(() => closeResultPopup(), 3000);
}

window.closeResultPopup = function() {
  const popup = document.getElementById("result-popup");
  if (popup) popup.style.display = "none";
};

function showChallengeInstructions(type) {
  const el = document.getElementById("challenge-instructions");
  if (!el) return;
  const instructions = {
    "hidden-code": `
      <strong style="color:#fff">🔢 Código Oculto — ¿Cómo jugar?</strong><br>
      Los números del código están ocultos entre ruido visual. Tu misión es encontrarlos.<br>
      <strong style="color:#fff">Pasa el cursor por el canvas</strong> para revelarlos — aparecerán en el orden en que deben escribirse.<br>
      Memoriza la secuencia y escríbela completa en el campo de respuesta antes de que se acabe el tiempo.
    `,
  };
  el.innerHTML = instructions[type] || "";
  el.style.display = instructions[type] ? "block" : "none";
}

// Start
connect();
