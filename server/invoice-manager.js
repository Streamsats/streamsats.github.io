import { getNWCClient } from "./nwc.js";
import { addToPool, addPendingInvoice, getPendingInvoice, removePendingInvoice } from "./game-state.js";
import dotenv from "dotenv";
dotenv.config();

const EXPIRY = parseInt(process.env.INVOICE_EXPIRY_SECONDS || "600");
const POLL_INTERVAL_MS = 3000;

let mockInvoiceCounter = 1;

export async function createSlotInvoice(challengeId, sats) {
  const client = getNWCClient();

  if (!client) {
    // Mock mode for development without NWC
    const paymentHash = `mock-${Date.now()}-${mockInvoiceCounter++}`;
    const invoice = `lnbc${sats}n1mock${paymentHash}`;
    const expiresAt = Date.now() + EXPIRY * 1000;
    const info = { paymentHash, invoice, amountSats: sats, challengeId, expiresAt, paid: false };
    addPendingInvoice(paymentHash, info);
    return { invoice, paymentHash, amountSats: sats, expiresAt };
  }

  const result = await client.makeInvoice({
    amount: sats * 1000, // msats
    description: `StreamSats — Slot para reto ${challengeId}`,
    expiry: EXPIRY
  });

  const paymentHash = result.payment_hash || result.paymentHash;
  const invoice = result.invoice || result.paymentRequest;
  const expiresAt = Date.now() + EXPIRY * 1000;
  const info = {
    paymentHash,
    invoice,
    amountSats: sats,
    challengeId,
    expiresAt,
    paid: false
  };
  addPendingInvoice(paymentHash, info);

  return { invoice, paymentHash, amountSats: sats, expiresAt };
}

export function startPollingInvoice(paymentHash, onPaid) {
  const client = getNWCClient();

  // Mock mode: auto-confirm after 5 seconds for testing
  if (!client) {
    console.log(`[mock] Will auto-confirm invoice ${paymentHash} in 5s`);
    setTimeout(() => {
      const info = getPendingInvoice(paymentHash);
      if (info && !info.paid) {
        info.paid = true;
        const poolTotal = addToPool(info.amountSats);
        removePendingInvoice(paymentHash);
        onPaid({ paymentHash, amountSats: info.amountSats, poolTotal });
      }
    }, 5000);
    return;
  }

  let attempts = 0;
  const maxAttempts = Math.ceil((EXPIRY * 1000) / POLL_INTERVAL_MS);

  const timer = setInterval(async () => {
    attempts++;
    if (attempts > maxAttempts) {
      clearInterval(timer);
      removePendingInvoice(paymentHash);
      return;
    }

    const info = getPendingInvoice(paymentHash);
    if (!info) { clearInterval(timer); return; }

    try {
      const result = await client.lookupInvoice({ payment_hash: paymentHash });
      if (result.settledAt || result.state === "SETTLED" || result.preimage) {
        clearInterval(timer);
        info.paid = true;
        const poolTotal = addToPool(info.amountSats);
        removePendingInvoice(paymentHash);
        onPaid({ paymentHash, amountSats: info.amountSats, poolTotal });
      }
    } catch (err) {
      console.error(`[invoice-manager] lookup error for ${paymentHash}:`, err.message);
    }
  }, POLL_INTERVAL_MS);
}
