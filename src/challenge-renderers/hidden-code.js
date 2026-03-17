/**
 * Renderer: hidden-code
 * Dígitos ocultos en ruido visual que aparecen al pasar el cursor sobre zonas específicas.
 * Los dígitos se reciben como imágenes PNG del servidor (nunca como texto).
 */
import { recordEvent, startRecording, stopRecording } from "../anti-cheat-client.js";

export function renderHiddenCode(canvas, config, sessionToken, onAnswer, wsBridge) {
  const ctx = canvas.getContext("2d");
  const { seed, digits: numDigits, noiseDensity } = config;

  // Per-session reveal zone positions (no code on client)
  const sessionSeed = simpleHash(seed + sessionToken);
  const revealZones = generateRevealZones(canvas.width, canvas.height, numDigits, sessionSeed);

  let revealed = new Set();
  let revealedImages = new Array(numDigits).fill(null);
  let pendingReveal = false;
  let inputCode = "";

  startRecording();

  // Draw noise
  const noiseData = generateNoise(canvas.width, canvas.height, noiseDensity, sessionSeed);

  // Listen for server responses
  function onZoneRevealed(data) {
    console.log("[hidden-code] zone:revealed received for index", data?.zoneIndex);
    const { zoneIndex, imageData } = data;
    const img = new Image();
    img.onload = () => {
      revealedImages[zoneIndex] = img;
      revealed.add(zoneIndex);
      pendingReveal = false;
    };
    img.onerror = () => {
      pendingReveal = false;
    };
    img.src = "data:image/png;base64," + imageData;
  }
  wsBridge.on("zone:revealed", onZoneRevealed);

  function draw(ts = 0) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Noise layer
    drawNoise(ctx, noiseData, canvas.width, canvas.height);

    // Reveal zones: highlight if hovering
    revealZones.forEach((zone, i) => {
      if (revealed.has(i) && revealedImages[i]) {
        // Permanently revealed — draw server image
        ctx.fillStyle = "rgba(0, 255, 157, 0.15)";
        ctx.beginPath();
        ctx.arc(zone.x, zone.y, zone.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.drawImage(revealedImages[i], zone.x - 32, zone.y - 32, 64, 64);
      } else {
        // Anonymous circle — subtle but findable
        ctx.fillStyle = "rgba(255,255,255,0.07)";
        ctx.beginPath();
        ctx.arc(zone.x, zone.y, zone.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(zone.x, zone.y, zone.r, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    // Header
    ctx.fillStyle = "#94a3b8";
    ctx.font = "13px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const next = revealed.size + 1;
    const msg = revealed.size < numDigits
      ? `Busca el dígito #${next} pasando el cursor por el canvas (${revealed.size}/${numDigits} revelados)`
      : `¡Todos revelados! Escribe el código y pulsa Enter`;
    ctx.fillText(msg, canvas.width / 2, 22);

    // Input display — boxes adapt to digit count
    const boxSize = Math.min(44, Math.floor((canvas.width - 40) / numDigits) - 4);
    const boxGap = boxSize + 4;
    const boxY = canvas.height - 60;
    const boxX = canvas.width / 2 - (numDigits * boxGap) / 2;
    for (let i = 0; i < numDigits; i++) {
      ctx.strokeStyle = inputCode[i] ? "#00ff9d" : "rgba(255,255,255,0.3)";
      ctx.lineWidth = 2;
      ctx.strokeRect(boxX + i * boxGap, boxY, boxSize, boxSize);
      if (inputCode[i]) {
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${Math.round(boxSize * 0.55)}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(inputCode[i], boxX + i * boxGap + boxSize / 2, boxY + boxSize / 2);
      }
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "11px monospace";
    ctx.fillText("Escribe el código y pulsa Enter", canvas.width / 2, canvas.height - 8);

    animFrameId = requestAnimationFrame(draw);
  }

  let animFrameId = requestAnimationFrame(draw);

  // Hover detection — requests digit image from server
  canvas.onmousemove = (e) => {
    if (pendingReveal) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    const nextToReveal = revealed.size;
    if (nextToReveal < revealZones.length) {
      const zone = revealZones[nextToReveal];
      const dist = Math.hypot(mx - zone.x, my - zone.y);
      if (dist <= zone.r) {
        pendingReveal = true;
        console.log("[hidden-code] sending zone:reveal for index", nextToReveal);
        wsBridge.send("zone:reveal", { zoneIndex: nextToReveal, sessionToken });
        recordEvent("hover", mx, my);
      }
    }
  };

  // Keyboard input
  const onKeydown = (e) => {
    if (e.key >= "0" && e.key <= "9" && inputCode.length < numDigits) {
      inputCode += e.key;
    } else if (e.key === "Backspace") {
      inputCode = inputCode.slice(0, -1);
    } else if (e.key === "Enter" && inputCode.length === numDigits) {
      stopRecording();
      onAnswer(inputCode);
    }
  };
  document.addEventListener("keydown", onKeydown);

  return () => {
    cancelAnimationFrame(animFrameId);
    canvas.onmousemove = null;
    document.removeEventListener("keydown", onKeydown);
    wsBridge.off("zone:revealed");
    stopRecording();
  };
}

function generateRevealZones(w, h, count, seed) {
  const zones = [];
  let s = seed + 99;
  const margin = 60;
  for (let i = 0; i < count; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const x = margin + (s % (w - margin * 2));
    s = (s * 1664525 + 1013904223) >>> 0;
    const y = 40 + margin + (s % (h - margin * 2 - 80));
    zones.push({ x, y, r: 45 });
  }
  return zones;
}

function generateNoise(w, h, density, seed) {
  const pixels = [];
  let s = seed;
  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < w; x += 4) {
      s = (s * 1664525 + 1013904223) >>> 0;
      if ((s % 100) < density * 100) {
        const v = s % 35 + 8;
        pixels.push({ x, y, v });
      }
    }
  }
  return pixels;
}

function drawNoise(ctx, pixels, w, h) {
  pixels.forEach(({ x, y, v }) => {
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(x, y, 3, 3);
  });
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
