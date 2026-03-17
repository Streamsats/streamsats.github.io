import { createCanvas } from "@napi-rs/canvas";

/**
 * Renderiza un dígito como imagen PNG con distorsiones anti-OCR.
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
  for (let y = 0; y < size; y += 2) {
    for (let x = 0; x < size; x += 2) {
      const v = Math.floor(rand() * 30) + 5;
      ctx.fillStyle = `rgb(${v},${v + Math.floor(rand() * 10)},${v})`;
      ctx.fillRect(x, y, 2, 2);
    }
  }

  // Interference lines
  const lineCount = 3 + Math.floor(rand() * 4);
  for (let i = 0; i < lineCount; i++) {
    ctx.strokeStyle = `rgba(${Math.floor(rand() * 100)},${Math.floor(rand() * 150 + 50)},${Math.floor(rand() * 100)},${0.3 + rand() * 0.3})`;
    ctx.lineWidth = 1 + rand() * 2;
    ctx.beginPath();
    ctx.moveTo(rand() * size, rand() * size);
    ctx.lineTo(rand() * size, rand() * size);
    ctx.stroke();
  }

  // Draw digit with rotation and scale distortion
  ctx.save();
  ctx.translate(size / 2, size / 2);
  const angle = (rand() - 0.5) * 0.7; // ±20° approx
  ctx.rotate(angle);
  const scaleX = 0.85 + rand() * 0.3;
  const scaleY = 0.85 + rand() * 0.3;
  ctx.scale(scaleX, scaleY);

  // Digit color — greenish/white tones
  const g = 180 + Math.floor(rand() * 75);
  const r = 150 + Math.floor(rand() * 60);
  const b = 140 + Math.floor(rand() * 50);
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.font = `bold ${28 + Math.floor(rand() * 10)}px "Liberation Mono", "DejaVu Sans Mono", monospace, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Slight offset
  const ox = (rand() - 0.5) * 6;
  const oy = (rand() - 0.5) * 6;
  ctx.fillText(digit, ox, oy);
  ctx.restore();

  // More noise on top of the digit
  for (let i = 0; i < 120; i++) {
    const px = Math.floor(rand() * size);
    const py = Math.floor(rand() * size);
    const v = Math.floor(rand() * 40) + 10;
    ctx.fillStyle = `rgba(${v},${v},${v},${0.3 + rand() * 0.4})`;
    ctx.fillRect(px, py, 2, 2);
  }

  return canvas.toBuffer("image/png");
}
