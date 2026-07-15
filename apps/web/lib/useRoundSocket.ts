"use client";

import { useEffect, useRef } from "react";
import { getToken, wsUrl } from "./api";

type Handler = (event: Record<string, unknown> & { type: string }) => void;

/** Subscribe to a round's realtime channel; auto-reconnects. */
export function useRoundSocket(roundId: string | null, onEvent: Handler) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!roundId) return;
    let closed = false;
    let ws: WebSocket;

    const connect = () => {
      const token = getToken();
      const base = wsUrl();
      ws = new WebSocket(token ? `${base}?token=${token}` : base);
      wsRef.current = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: "subscribe", roundId }));
      ws.onmessage = (e) => {
        try {
          handlerRef.current(JSON.parse(e.data));
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        if (!closed) setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      closed = true;
      ws.close();
    };
  }, [roundId]);

  return {
    sendChat: (text: string) => {
      if (roundId && wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: "chat", roundId, text }));
    },
    sendReact: (emoji: string) => {
      if (roundId && wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: "react", roundId, emoji }));
    },
  };
}
