/**
 * WebSocket client con reconexión automática.
 */

const WS_URL = import.meta.env.VITE_WS_URL || `ws://${window.location.hostname}:3002`;
const RECONNECT_DELAY_MS = 3000;

let ws = null;
let handlers = {};
let reconnectTimer = null;

export function on(event, fn) {
  handlers[event] = fn;
}

export function off(event) {
  delete handlers[event];
}

export function send(event, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event, data }));
    return true;
  }
  return false;
}

export function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log("[ws] connected");
    clearTimeout(reconnectTimer);
    if (handlers["ws:connected"]) handlers["ws:connected"]();
  };

  ws.onmessage = (e) => {
    try {
      const { event, data } = JSON.parse(e.data);
      if (handlers[event]) handlers[event](data);
    } catch (err) {
      console.error("[ws] parse error:", err);
    }
  };

  ws.onclose = () => {
    console.log("[ws] disconnected, reconnecting...");
    if (handlers["ws:disconnected"]) handlers["ws:disconnected"]();
    reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
  };

  ws.onerror = (err) => {
    console.error("[ws] error:", err);
    ws.close();
  };
}

export function disconnect() {
  clearTimeout(reconnectTimer);
  if (ws) ws.close();
}
