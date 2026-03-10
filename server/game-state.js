/**
 * Estado global en memoria del juego.
 * Un solo reto activo a la vez, pool acumulado, sesiones de pago.
 */

const MINIMUM_POOL_SATS = 10;

const state = {
  currentChallengeId: null,
  prizePoolSats: MINIMUM_POOL_SATS,
  playersOnline: 0,
  activeSessions: new Map(),   // paymentHash → sessionInfo
  pendingInvoices: new Map(),  // paymentHash → invoiceInfo
};

export function getState() {
  return state;
}

export function setCurrentChallenge(challengeId) {
  state.currentChallengeId = challengeId;
}

export function addToPool(sats) {
  state.prizePoolSats += sats;
  return state.prizePoolSats;
}

export function resetPool() {
  const old = state.prizePoolSats;
  state.prizePoolSats = MINIMUM_POOL_SATS;
  return old;
}

export function setPlayersOnline(n) {
  state.playersOnline = n;
}

export function addPendingInvoice(paymentHash, info) {
  state.pendingInvoices.set(paymentHash, info);
}

export function getPendingInvoice(paymentHash) {
  return state.pendingInvoices.get(paymentHash);
}

export function removePendingInvoice(paymentHash) {
  state.pendingInvoices.delete(paymentHash);
}

export function addSession(sessionToken, info) {
  state.activeSessions.set(sessionToken, info);
}

export function getSession(sessionToken) {
  return state.activeSessions.get(sessionToken);
}

export function removeSession(sessionToken) {
  state.activeSessions.delete(sessionToken);
}
