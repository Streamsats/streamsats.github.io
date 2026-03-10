import { LightningAddress } from "@getalby/lightning-tools";
import { getNWCClient } from "./nwc.js";
import dotenv from "dotenv";
dotenv.config();

export async function payWinner(winnerLightningAddress, prizePoolSats) {
  const payoutSats = prizePoolSats; // commission already retained at payment time
  const client = getNWCClient();

  console.log(`💰 Payout: ${payoutSats} sats → ${winnerLightningAddress}`);

  if (!client) {
    console.log("[mock] Payout simulado (no NWC configurado)");
    return { ok: true, payoutSats, mock: true };
  }

  try {
    // 1. Resolver Lightning Address para obtener invoice
    const ln = new LightningAddress(winnerLightningAddress);
    await ln.fetch();
    const invoice = await ln.requestInvoice({ satoshi: payoutSats });

    // 2. Pagar invoice via NWC
    const result = await client.payInvoice({ invoice: invoice.paymentRequest });

    console.log(`✅ Pago enviado! Preimage: ${result.preimage}`);
    return { ok: true, payoutSats, preimage: result.preimage };
  } catch (err) {
    console.error("❌ Error en payout:", err.message);
    return { ok: false, error: err.message, payoutSats };
  }
}
