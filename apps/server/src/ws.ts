import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { COSMETICS, type ChatMessage, type ClientEvent, type ServerEvent } from "@cookout/shared";
import type { Store } from "./store.js";

interface Client {
  ws: WebSocket;
  address?: string;
  rooms: Set<string>;
}

/**
 * Realtime hub. Clients subscribe to round channels; the engine broadcasts
 * through this. Anyone may watch (spectator mode); chat requires a session.
 */
export class Hub {
  private clients = new Set<Client>();

  constructor(private store: Store) {}

  attach(server: Server): void {
    const wss = new WebSocketServer({ server, path: "/ws" });
    wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      const url = new URL(req.url ?? "/ws", "http://localhost");
      const token = url.searchParams.get("token");
      const client: Client = {
        ws,
        address: token ? this.store.sessions.get(token) : undefined,
        rooms: new Set(),
      };
      this.clients.add(client);
      ws.on("message", (raw: Buffer) => {
        let msg: ClientEvent;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        this.handle(client, msg);
      });
      ws.on("close", () => this.clients.delete(client));
    });
  }

  private handle(client: Client, msg: ClientEvent): void {
    switch (msg.type) {
      case "subscribe":
        client.rooms.add(msg.roundId);
        break;
      case "unsubscribe":
        client.rooms.delete(msg.roundId);
        break;
      case "chat": {
        if (!client.address) {
          if (client.ws.readyState === WebSocket.OPEN)
            client.ws.send(JSON.stringify({ type: "error", message: "sign in to chat" }));
          return;
        }
        const text = msg.text.trim().slice(0, 280);
        if (!text) return;
        const user = this.store.users.get(client.address);
        const badge = COSMETICS.find((c) => c.id === user?.equipped.badge)?.value;
        const color = COSMETICS.find((c) => c.id === user?.equipped.chatColor)?.value;
        const message: ChatMessage = {
          id: this.store.id(),
          roundId: msg.roundId,
          userAddress: client.address,
          displayName: user?.displayName,
          text,
          at: Date.now(),
          badge,
          color,
        };
        let list = this.store.chat.get(msg.roundId);
        if (!list) {
          list = [];
          this.store.chat.set(msg.roundId, list);
        }
        list.push(message);
        if (list.length > 500) list.splice(0, list.length - 500);
        this.broadcast(msg.roundId, { type: "chat", message });
        break;
      }
    }
  }

  broadcast = (roundId: string, event: ServerEvent): void => {
    const payload = JSON.stringify(event);
    for (const c of this.clients) {
      if (c.rooms.has(roundId) && c.ws.readyState === WebSocket.OPEN) c.ws.send(payload);
    }
  };

  /** Watchers of a round (subscribed connections). */
  spectatorCount = (roundId: string): number => {
    let n = 0;
    for (const c of this.clients) if (c.rooms.has(roundId)) n++;
    return n;
  };
}
