/**
 * Actualizaciones de DOM: prize pool, status, timer, players.
 */

let poolAnimTimer = null;
let displayedPool = 0;

export function updateGameState({ challengeId, title, type, prizePoolSats, playersOnline, slotPriceSats }) {
  setEl("challenge-title", title);
  setEl("challenge-title-side", title);
  setEl("challenge-type", type);
  setEl("slot-price", `${slotPriceSats} sats`);
  setEl("players-online", `${playersOnline} jugador${playersOnline !== 1 ? "es" : ""} en línea`);
  animatePool(prizePoolSats);
}

export function animatePool(targetSats) {
  clearInterval(poolAnimTimer);
  const start = displayedPool;
  const diff = targetSats - start;
  if (diff === 0) return;

  const steps = Math.min(Math.abs(diff), 30);
  let step = 0;
  poolAnimTimer = setInterval(() => {
    step++;
    displayedPool = Math.round(start + (diff * step) / steps);
    renderPool(displayedPool);
    if (step >= steps) {
      clearInterval(poolAnimTimer);
      displayedPool = targetSats;
      renderPool(displayedPool);
    }
  }, 30);
}

function renderPool(sats) {
  const el = document.getElementById("prize-pool");
  if (el) {
    el.textContent = sats.toLocaleString();
    el.classList.add("pool-flash");
    setTimeout(() => el.classList.remove("pool-flash"), 300);
  }
}

export function startSlotTimer(slotExpiresAt, onExpire) {
  const el = document.getElementById("slot-timer");
  const el2 = document.getElementById("slot-timer-inline");

  const tick = () => {
    const remaining = Math.max(0, slotExpiresAt - Date.now());
    const secs = Math.ceil(remaining / 1000);
    const text = secs > 0 ? `⏱ ${secs}s` : "⏱ 0s";
    if (el) { el.textContent = text; el.style.display = "block"; }
    if (el2) el2.textContent = text;
    if (remaining <= 0) {
      clearInterval(timer);
      if (el) el.style.display = "none";
      if (onExpire) onExpire();
    }
  };
  tick();
  const timer = setInterval(tick, 250);
  return timer;
}

export function setStatus(text, type = "info") {
  const el = document.getElementById("status-bar");
  if (!el) return;
  el.textContent = text;
  el.className = `status-bar status-${type}`;
}

export function showSection(id) {
  document.querySelectorAll(".game-section").forEach(el => el.classList.remove("active"));
  const el = document.getElementById(id);
  if (el) el.classList.add("active");
}

export function showVictoryScreen(paidSats, nextChallengeIn) {
  const el = document.getElementById("victory-screen");
  if (!el) return;
  document.getElementById("victory-sats").textContent = paidSats.toLocaleString();
  el.classList.add("show");
  let countdown = nextChallengeIn;
  const cd = document.getElementById("victory-countdown");
  const t = setInterval(() => {
    countdown--;
    if (cd) cd.textContent = countdown;
    if (countdown <= 0) {
      clearInterval(t);
      el.classList.remove("show");
    }
  }, 1000);
}

function setEl(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
