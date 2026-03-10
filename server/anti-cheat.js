import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

const SECRET = process.env.JWT_SECRET || "streamsats-default-secret";

export function generateSessionToken(paymentHash, challengeId, slotExpiresAt, answerDeadlineAt) {
  const payload = { paymentHash, challengeId, slotExpiresAt, answerDeadlineAt };
  const data = JSON.stringify(payload);
  const sig = crypto.createHmac("sha256", SECRET).update(data).digest("hex");
  return Buffer.from(data).toString("base64") + "." + sig;
}

export function decodeSessionToken(token) {
  try {
    const [b64, sig] = token.split(".");
    if (!b64 || !sig) return null;
    const data = Buffer.from(b64, "base64").toString("utf-8");
    const expected = crypto.createHmac("sha256", SECRET).update(data).digest("hex");
    if (expected !== sig) return null;
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function validateSessionToken(token) {
  const payload = decodeSessionToken(token);
  if (!payload) return { valid: false, reason: "invalid token" };
  if (Date.now() > payload.answerDeadlineAt) return { valid: false, reason: "answer window expired" };
  return { valid: true, payload };
}

export function validateInteractionProof(proof, challenge, sessionToken) {
  try {
    const events = JSON.parse(Buffer.from(proof, "base64").toString("utf-8"));
    if (!Array.isArray(events) || events.length === 0) return false;
    const requiredClicks = challenge.config.requiredClicks || 1;
    return events.length >= requiredClicks;
  } catch {
    return false;
  }
}

export function hashAnswer(answer) {
  return crypto.createHash("sha256").update(answer.toLowerCase().trim()).digest("hex");
}
