"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { GLOBAL_ROOM, type ActivityEvent, type ChatMessage, type PresenceUser } from "@cookout/shared";
import { api, getToken, wsUrl } from "./api";
import { useSession } from "./session";

/**
 * The persistent social layer.
 *
 * One connection to The Cookout (the global room) lives for the whole session,
 * mounted in the root layout — it survives navigation, so players never leave
 * the crowd. Match rooms are separate, page-scoped subscriptions layered on
 * top (useRoundSocket), which keeps match talk out of global and global
 * flowing while you trade.
 */

export interface ActiveMatch {
  id: string;
  symbol: string;
  /** Round is over: the room is readable but frozen. */
  frozen?: boolean;
}

interface SocialValue {
  online: PresenceUser[];
  /** The Cookout (global room). */
  messages: ChatMessage[];
  /** The match room you're standing in, if any. */
  matchMessages: ChatMessage[];
  /** Set by the round page — drives the dock's channel switch. */
  activeMatch: ActiveMatch | null;
  setActiveMatch: (m: ActiveMatch | null) => void;
  /** Which channel the dock is showing. */
  channel: "global" | "match";
  setChannel: (c: "global" | "match") => void;
  /** Cheer into the active match room. */
  react: (emoji: string) => void;
  /** Site-wide activity, newest first. */
  activity: ActivityEvent[];
  /** Addresses the signed-in player follows. */
  following: string[];
  setFollow: (address: string, follow: boolean) => Promise<void>;
  connected: boolean;
  /** Messages that arrived while the dock was closed. */
  unread: number;
  /** The dock reports whether the user can actually see the room. */
  setReading: (reading: boolean) => void;
  send: (text: string) => void;
}

const Ctx = createContext<SocialValue>({
  online: [],
  messages: [],
  matchMessages: [],
  activeMatch: null,
  setActiveMatch: () => {},
  channel: "global",
  setChannel: () => {},
  react: () => {},
  activity: [],
  following: [],
  setFollow: async () => {},
  connected: false,
  unread: 0,
  setReading: () => {},
  send: () => {},
});

export const useSocial = () => useContext(Ctx);

export function SocialProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useSession();
  const [online, setOnline] = useState<PresenceUser[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [matchMessages, setMatchMessages] = useState<ChatMessage[]>([]);
  const [activeMatch, setActiveMatchState] = useState<ActiveMatch | null>(null);
  const [channel, setChannel] = useState<"global" | "match">("global");
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [following, setFollowing] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [unread, setUnread] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const readingRef = useRef(false);
  // The socket callback is created once; refs keep it reading fresh values.
  const matchRef = useRef<ActiveMatch | null>(null);
  const channelRef = useRef<"global" | "match">("global");
  matchRef.current = activeMatch;
  channelRef.current = channel;

  // Seed history + roster so the dock is populated before the socket settles.
  useEffect(() => {
    api<{ messages: ChatMessage[]; online: PresenceUser[] }>("/api/social/global")
      .then((d) => {
        setMessages(d.messages ?? []);
        setOnline(d.online ?? []);
      })
      .catch(() => {});
  }, []);

  // Feed + follow list: refetched when the session changes (following is
  // per-player) and topped up live by the socket.
  useEffect(() => {
    api<{ events: ActivityEvent[]; following: string[] }>("/api/social/feed")
      .then((d) => {
        setActivity(d.events ?? []);
        setFollowing(d.following ?? []);
      })
      .catch(() => {});
  }, [profile?.address]);

  // One long-lived connection to the global room. Reconnects on drop, and
  // re-opens when the session changes so the server sees the right identity.
  const token = profile ? getToken() : null;
  useEffect(() => {
    let closed = false;
    let ws: WebSocket;
    let retry: ReturnType<typeof setTimeout>;

    const connect = () => {
      const base = wsUrl();
      ws = new WebSocket(token ? `${base}?token=${token}` : base);
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        ws.send(JSON.stringify({ type: "subscribe", roundId: GLOBAL_ROOM }));
      };
      ws.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data) as { type: string } & Record<string, unknown>;
          if (ev.type === "presence") {
            setOnline((ev.online as PresenceUser[]) ?? []);
          } else if (ev.type === "activity") {
            setActivity((prev) => [ev.event as ActivityEvent, ...prev].slice(0, 120));
          } else if (ev.type === "chat") {
            const m = ev.message as ChatMessage;
            if (m.roundId === GLOBAL_ROOM) {
              setMessages((prev) => [...prev.slice(-199), m]);
              if (!readingRef.current || channelRef.current !== "global")
                setUnread((n) => n + 1);
            } else if (m.roundId === matchRef.current?.id) {
              setMatchMessages((prev) => [...prev.slice(-299), m]);
              if (!readingRef.current || channelRef.current !== "match")
                setUnread((n) => n + 1);
            }
          }
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [token]);

  // Presence also refreshes on a slow poll — covers missed frames and keeps
  // statuses honest when someone's round changes phase.
  useEffect(() => {
    const t = setInterval(() => {
      api<{ online: PresenceUser[] }>("/api/social/online")
        .then((d) => setOnline(d.online ?? []))
        .catch(() => {});
    }, 20_000);
    return () => clearInterval(t);
  }, []);

  /**
   * Enter or leave a match room. The round page calls this on mount/unmount,
   * so the dock follows you into the match and drops back to The Cookout when
   * you navigate away — one chat surface, contextual channel.
   */
  const setActiveMatch = useCallback((m: ActiveMatch | null) => {
    const prev = matchRef.current;
    if (prev?.id === m?.id) {
      // Same room, updated metadata (e.g. it just froze).
      if (m) setActiveMatchState(m);
      return;
    }
    const ws = wsRef.current;
    if (prev && ws?.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: "unsubscribe", roundId: prev.id }));
    setActiveMatchState(m);
    setMatchMessages([]);
    if (m) {
      if (ws?.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: "subscribe", roundId: m.id }));
      api<{ messages: ChatMessage[] }>(`/api/chat/${m.id}`)
        .then((d) => setMatchMessages(d.messages ?? []))
        .catch(() => {});
      setChannel("match");
    } else {
      setChannel("global");
    }
  }, []);

  // Re-subscribe to the active match after a reconnect.
  useEffect(() => {
    if (!connected || !activeMatch) return;
    wsRef.current?.send(JSON.stringify({ type: "subscribe", roundId: activeMatch.id }));
  }, [connected, activeMatch]);

  const react = useCallback((emoji: string) => {
    const m = matchRef.current;
    if (!m || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "react", roundId: m.id, emoji }));
  }, []);

  const send = useCallback((text: string) => {
    const body = text.trim();
    if (!body || wsRef.current?.readyState !== WebSocket.OPEN) return;
    const room =
      channelRef.current === "match" && matchRef.current ? matchRef.current.id : GLOBAL_ROOM;
    wsRef.current.send(JSON.stringify({ type: "chat", roundId: room, text: body }));
  }, []);

  const setFollow = useCallback(async (address: string, follow: boolean) => {
    // Optimistic — the card flips instantly, the server is the record.
    setFollowing((prev) =>
      follow
        ? [...new Set([...prev, address.toLowerCase()])]
        : prev.filter((a) => a !== address.toLowerCase()),
    );
    try {
      const r = await api<{ following: string[] }>("/api/me/follow", { body: { address, follow } });
      setFollowing(r.following ?? []);
    } catch {
      /* keep the optimistic state; next fetch reconciles */
    }
  }, []);

  const setReading = useCallback((reading: boolean) => {
    readingRef.current = reading;
    if (reading) setUnread(0);
  }, []);

  return (
    <Ctx.Provider
      value={{
        online,
        messages,
        matchMessages,
        activeMatch,
        setActiveMatch,
        channel,
        setChannel,
        react,
        activity,
        following,
        setFollow,
        connected,
        unread,
        setReading,
        send,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
