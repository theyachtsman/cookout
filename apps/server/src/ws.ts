import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  COSMETICS,
  GLOBAL_ROOM,
  type ChatMessage,
  type ClientEvent,
  type PresenceStatus,
  type PresenceUser,
  type ServerEvent,
  type SystemChatKind,
} from "@cookout/shared";
import { activeRugBan, type Store } from "./store.js";

interface Client {
  ws: WebSocket;
  address?: string;
  rooms: Set<string>;
  lastReactionAt?: number;
  lastChatAt?: number;
}

/**
 * Realtime hub and the site's social layer.
 *
 * Every connection joins the always-on GLOBAL_ROOM ("The Cookout") the moment
 * it opens and never leaves it — players are hanging out together before,
 * during, and after matches. Match rooms are additional subscriptions layered
 * on top, so match talk never pollutes global and global keeps flowing while
 * you trade. Presence is derived from live connections and pushed to global
 * so every screen can answer "who is here and what are they doing?".
 */
export class Hub {
  private clients = new Set<Client>();
  private presenceTimer: NodeJS.Timeout | null = null;

  constructor(private store: Store) {
    // Activity recorded anywhere in the app fans out to everyone hanging out.
    store.onActivity = (event) => this.broadcast(GLOBAL_ROOM, { type: "activity", event });
  }

  attach(server: Server): void {
    const wss = new WebSocketServer({ server, path: "/ws" });
    wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      const url = new URL(req.url ?? "/ws", "http://localhost");
      const token = url.searchParams.get("token");
      const client: Client = {
        ws,
        address: token ? this.store.sessionAddress(token) : undefined,
        // Everyone lands in The Cookout the second they connect.
        rooms: new Set([GLOBAL_ROOM]),
      };
      this.clients.add(client);
      this.schedulePresence();
      ws.on("message", (raw: Buffer) => {
        let msg: ClientEvent;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        this.handle(client, msg);
      });
      ws.on("close", () => {
        this.clients.delete(client);
        this.schedulePresence();
      });
    });
  }

  private handle(client: Client, msg: ClientEvent): void {
    switch (msg.type) {
      case "subscribe":
        client.rooms.add(msg.roundId);
        this.schedulePresence();
        break;
      case "unsubscribe":
        // Global is permanent — leaving a match returns you to the crowd.
        if (msg.roundId !== GLOBAL_ROOM) client.rooms.delete(msg.roundId);
        this.schedulePresence();
        break;
      case "react": {
        // Spectator cheers: authenticated, whitelisted emoji, ≤1/second.
        if (!client.address || !client.rooms.has(msg.roundId)) return;
        const now = Date.now();
        if (client.lastReactionAt && now - client.lastReactionAt < 1000) return;
        if (!["🔥", "🚀", "😂", "💀", "🧊", "📉"].includes(msg.emoji)) return;
        client.lastReactionAt = now;
        this.broadcast(msg.roundId, {
          type: "reaction",
          roundId: msg.roundId,
          emoji: msg.emoji,
          from: client.address,
        });
        break;
      }
      case "chat": {
        if (!client.address) {
          if (client.ws.readyState === WebSocket.OPEN)
            client.ws.send(JSON.stringify({ type: "error", message: "sign in to chat" }));
          return;
        }
        // Throttle: one message per 800ms per connection.
        const nowMs = Date.now();
        if (client.lastChatAt && nowMs - client.lastChatAt < 800) return;
        client.lastChatAt = nowMs;
        const mutedUntil = this.store.muted.get(client.address);
        if (mutedUntil && mutedUntil > Date.now()) {
          if (client.ws.readyState === WebSocket.OPEN)
            client.ws.send(
              JSON.stringify({ type: "error", message: "you are muted by a moderator" }),
            );
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
          level: user?.level,
          // Rugged-and-banned players keep their voice, but wear the mark
          // until they (or an admin) lift the ban.
          banned: user && activeRugBan(user) ? true : undefined,
        };
        this.push(msg.roundId, message);
        break;
      }
    }
  }

  /** Append to a room's history (rooms are frozen, never destroyed, when a
   *  match ends — legendary rounds stay readable forever) and fan out. */
  private push(roomId: string, message: ChatMessage): void {
    let list = this.store.chat.get(roomId);
    if (!list) {
      list = [];
      this.store.chat.set(roomId, list);
    }
    list.push(message);
    const cap = roomId === GLOBAL_ROOM ? 300 : 500;
    if (list.length > cap) list.splice(0, list.length - cap);
    this.broadcast(roomId, { type: "chat", message });
  }

  /** Match system event — rendered as an inline banner inside the room. */
  system = (roomId: string, kind: SystemChatKind, text: string): void => {
    this.push(roomId, {
      id: this.store.id(),
      roundId: roomId,
      userAddress: "system",
      text,
      at: Date.now(),
      system: true,
      systemKind: kind,
    });
  };

  /** Who is online and what they're doing, newest-status-first. */
  presence = (): PresenceUser[] => {
    const seen = new Map<string, PresenceUser>();
    for (const c of this.clients) {
      if (!c.address) continue; // anonymous watchers aren't listed
      const user = this.store.users.get(c.address);
      if (!user) continue;
      // A player's status comes from the match room they're standing in.
      let status: PresenceStatus = "hanging";
      let roundId: string | undefined;
      let roundSymbol: string | undefined;
      for (const room of c.rooms) {
        if (room === GLOBAL_ROOM) continue;
        const round = this.store.rounds.get(room);
        if (!round) continue;
        roundId = round.id;
        roundSymbol = round.token.symbol;
        const pos = this.store.positions.get(round.id)?.get(c.address);
        if (round.state === "queue_open" || round.state === "lobby") status = "queue";
        else if (round.state === "live" || round.state === "settling")
          status = pos && pos.tokens > 0 ? "trading" : "spectating";
        else status = "finished";
        break;
      }
      const prev = seen.get(c.address);
      // Multiple tabs: the most engaged status wins.
      const rank: Record<PresenceStatus, number> = {
        trading: 4,
        queue: 3,
        spectating: 2,
        finished: 1,
        hanging: 0,
      };
      if (prev && rank[prev.status] >= rank[status]) continue;
      seen.set(c.address, {
        address: c.address,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        level: user.level,
        title: user.title,
        badge: COSMETICS.find((x) => x.id === user.equipped.badge)?.value,
        status,
        roundId,
        roundSymbol,
      });
    }
    return [...seen.values()].sort(
      (a, b) => b.level - a.level || (a.displayName ?? a.address).localeCompare(b.displayName ?? b.address),
    );
  };

  /** Coalesce presence churn (connect storms, room hops) into one push. */
  private schedulePresence(): void {
    if (this.presenceTimer) return;
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      this.broadcast(GLOBAL_ROOM, { type: "presence", online: this.presence() });
    }, 400);
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
