import { useEffect, useState } from "react";
import { api, ApiError, type HardwareSnapshot } from "../api/client.js";

export type FeedConnection = "connecting" | "live" | "polling" | "offline";

const POLL_FALLBACK_MS = 2000;

/**
 * Live hardware snapshots for as long as the calling page is mounted: its
 * own /api/ws connection subscribed to the "hardware" topic (the server only
 * polls control sockets while someone is subscribed), falling back to
 * polling GET /api/hardware while the socket is down.
 */
export function useHardwareFeed(): { snapshot: HardwareSnapshot | null; connection: FeedConnection; error: string | null } {
  const [snapshot, setSnapshot] = useState<HardwareSnapshot | null>(null);
  const [connection, setConnection] = useState<FeedConnection>("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let retryMs = 1000;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    async function poll() {
      try {
        const snap = await api.getHardware();
        if (stopped) return;
        setSnapshot(snap);
        setError(null);
        setConnection((c) => (c === "live" ? c : "polling"));
      } catch (err) {
        if (stopped) return;
        setError(err instanceof ApiError ? err.message : "Failed to load hardware status");
        setConnection((c) => (c === "live" ? c : "offline"));
      }
    }

    function startPolling() {
      if (pollTimer) return;
      void poll();
      pollTimer = setInterval(() => void poll(), POLL_FALLBACK_MS);
    }

    function stopPolling() {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }

    function connect() {
      if (typeof WebSocket === "undefined") {
        startPolling();
        return;
      }
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${scheme}://${window.location.host}/api/ws`);
      socket.onmessage = (event) => {
        let msg: { type?: string; data?: HardwareSnapshot };
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (msg.type === "hello") {
          retryMs = 1000;
          socket?.send(JSON.stringify({ type: "subscribe", topic: "hardware" }));
        } else if (msg.type === "hardware" && msg.data) {
          stopPolling();
          setSnapshot(msg.data);
          setError(null);
          setConnection("live");
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        setConnection((c) => (c === "live" ? "polling" : c));
        startPolling();
        retryTimer = setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 30_000);
      };
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      stopPolling();
      socket?.close();
    };
  }, []);

  return { snapshot, connection, error };
}
