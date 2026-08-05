import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./middleware/auth";

const clients = new Map<string, Set<WebSocket>>();

/**
 * Attach WebSocket server to HTTP server.
 * Clients connect with JWT in query string: ?token=xxx
 * Server pushes ticket updates, notifications, and status changes.
 */
export function setupWebSocket(server: HttpServer): void {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "/", "http://localhost");
    const token = url.searchParams.get("token");

    if (!token) {
      ws.close(4001, "Missing token");
      return;
    }

    let userId: string;
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
      userId = payload.userId;
    } catch {
      ws.close(4001, "Invalid token");
      return;
    }

    // Register client
    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId)!.add(ws);

    console.log(`[WS] User ${userId} connected`);

    ws.on("close", () => {
      clients.get(userId)?.delete(ws);
      if (clients.get(userId)?.size === 0) clients.delete(userId);
      console.log(`[WS] User ${userId} disconnected`);
    });

    ws.on("error", (err) => {
      console.error(`[WS] Error for user ${userId}:`, err.message);
    });

    // Send welcome
    ws.send(JSON.stringify({ type: "connected", userId }));
  });

  console.log("[WS] WebSocket server ready on /ws");
}

/**
 * Send a real-time event to a specific user.
 */
export function notifyUser(userId: string, event: { type: string; payload: unknown }): void {
  const sockets = clients.get(userId);
  if (!sockets) return;
  const message = JSON.stringify(event);
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

/**
 * Broadcast an event to all connected users (admin alerts, etc.)
 */
export function broadcast(event: { type: string; payload: unknown }): void {
  const message = JSON.stringify(event);
  for (const [, sockets] of clients) {
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(message);
    }
  }
}
