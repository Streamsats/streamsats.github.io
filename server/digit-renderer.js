import { createCanvas } from "@napi-rs/canvas";

// 7-segment definitions: which segments are ON for each digit
// Segments: a=top, b=top-right, c=bottom-right, d=bottom, e=bottom-left, f=top-left, g=middle
const SEGS = {
  "0": "abcdef",
  "1": "bc",
  "2": "abdeg",
  "3": "abcdg",
  "4": "bcfg",
  "5": "acdfg",
  "6": "acdefg",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
};

/**
 * Renderiza un dígito como imagen PNG con estilo 7-segmentos y distorsiones anti-OCR.
 * No depende de fuentes del sistema.
 * @param {string} digit — un solo carácter '0'-'9'
 * @param {number} seed — semilla para variaciones deterministas
 * @returns {Buffer} PNG buffer
 */
export function renderDigitImage(digit, seed) {
  const size = 80;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  // Seeded PRNG
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s >>> 0) / 0x100000000;
  };

  // Background noise
  ctx.fillStyle = "#0a1a0a";
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 2) {
    for (let x = 0; x < size; x += 2) {
      if (rand() < 0.35) {
        const v = Math.floor(rand() * 25) + 5;
        ctx.fillStyle = `rgb(${v},${v + Math.floor(rand() * 8)},${v})`;
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }

  // Interference lines
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = `rgba(0,${Math.floor(rand() * 80 + 40)},0,${0.2 + rand() * 0.2})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rand() * size, rand() * size);
    ctx.lineTo(rand() * size, rand() * size);
    ctx.stroke();
  }

  // Draw 7-segment digit
  const segs = SEGS[digit] || "";
  const angle = (rand() - 0.5) * 0.4;  // ±~12° rotation
  const ox = 4 + rand() * 8;            // horizontal offset variation
  const brightness = 180 + Math.floor(rand() * 75);
  const color = `rgb(${Math.floor(brightness * 0.7)}, ${brightness}, ${Math.floor(brightness * 0.6)})`;
  const w = 18;   // segment width
  const h = 16;   // segment half-height
  const t = 5;    // segment thickness

  ctx.save();
  ctx.translate(size / 2 + (rand() - 0.5) * 6, size / 2 + (rand() - 0.5) * 6);
  ctx.rotate(angle);
  ctx.fillStyle = color;

  // a: top
  if (segs.includes("a")) drawH(ctx, -w / 2 + ox, -h - t / 2, w, t);
  // b: top-right
  if (segs.includes("b")) drawV(ctx, w / 2 + ox, -h, t, h);
  // c: bottom-right
  if (segs.includes("c")) drawV(ctx, w / 2 + ox, 0, t, h);
  // d: bottom
  if (segs.includes("d")) drawH(ctx, -w / 2 + ox, h - t / 2, w, t);
  // e: bottom-left
  if (segs.includes("e")) drawV(ctx, -w / 2 - t + ox, 0, t, h);
  // f: top-left
  if (segs.includes("f")) drawV(ctx, -w / 2 - t + ox, -h, t, h);
  // g: middle
  if (segs.includes("g")) drawH(ctx, -w / 2 + ox, -t / 2, w, t);

  ctx.restore();

  // Noise overlay
  for (let i = 0; i < 80; i++) {
    const px = Math.floor(rand() * size);
    const py = Math.floor(rand() * size);
    ctx.fillStyle = `rgba(0,${Math.floor(rand() * 40 + 10)},0,${0.2 + rand() * 0.3})`;
    ctx.fillRect(px, py, 2, 2);
  }

  return canvas.toBuffer("image/png");
}

function drawH(ctx, x, y, w, h) {
  ctx.beginPath();
  ctx.moveTo(x + h * 0.3, y);
  ctx.lineTo(x + w - h * 0.3, y);
  ctx.lineTo(x + w, y + h / 2);
  ctx.lineTo(x + w - h * 0.3, y + h);
  ctx.lineTo(x + h * 0.3, y + h);
  ctx.lineTo(x, y + h / 2);
  ctx.closePath();
  ctx.fill();
}

function drawV(ctx, x, y, w, h) {
  ctx.beginPath();
  ctx.moveTo(x, y + w * 0.3);
  ctx.lineTo(x + w / 2, y);
  ctx.lineTo(x + w, y + w * 0.3);
  ctx.lineTo(x + w, y + h - w * 0.3);
  ctx.lineTo(x + w / 2, y + h);
  ctx.lineTo(x, y + h - w * 0.3);
  ctx.closePath();
  ctx.fill();
}
