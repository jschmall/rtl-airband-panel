import { useEffect, useRef, useState } from "react";
import { logsStreamUrl, type LogLine } from "../api/client.js";
import { Collapsible } from "./Collapsible.js";

type ConnState = "closed" | "connecting" | "live" | "reconnecting" | "error";

const MAX_LINES = 500;
// Roughly "at the bottom" rather than exactly, since a fraction-of-a-pixel
// rounding difference shouldn't be enough to un-stick auto-scroll.
const STICK_TO_BOTTOM_THRESHOLD_PX = 32;

const STATE_LABEL: Record<ConnState, string> = {
  closed: "",
  connecting: "Connecting…",
  live: "● Live",
  reconnecting: "Reconnecting…",
  error: "Connection failed",
};

export function InstanceLogs({ name }: { name: string }) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [state, setState] = useState<ConnState>("closed");
  const [open, setOpen] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const stickToBottom = useRef(true);

  // Opens the stream only while the section is actually expanded -- a
  // collapsed/never-opened section shouldn't hold a connection (or, in sudo
  // mode, a spawned `journalctl -f` process) open in the background.
  useEffect(() => {
    if (!open) {
      setState("closed");
      return;
    }
    setLines([]);
    stickToBottom.current = true;
    setState("connecting");
    const es = new EventSource(logsStreamUrl(name));
    es.onopen = () => setState("live");
    es.onmessage = (evt: MessageEvent<string>) => {
      const line = JSON.parse(evt.data) as LogLine;
      setLines((prev) => (prev.length >= MAX_LINES ? [...prev.slice(prev.length - MAX_LINES + 1), line] : [...prev, line]));
    };
    es.addEventListener("stream-error", () => setState("error"));
    // Fires on any connection-level failure -- EventSource retries on its own
    // (readyState becomes CONNECTING again), so this only needs to reflect
    // that in the label, not manually reconnect.
    es.onerror = () => setState(es.readyState === EventSource.CLOSED ? "error" : "reconnecting");
    return () => es.close();
  }, [name, open]);

  useEffect(() => {
    if (!stickToBottom.current || !preRef.current) return;
    preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [lines]);

  function handleScroll() {
    const el = preRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_THRESHOLD_PX;
  }

  return (
    <Collapsible
      className="rounded-lg border border-slate-700 bg-slate-900 p-4"
      titleClassName="text-lg font-semibold text-slate-100"
      title="Logs"
      onOpenChange={setOpen}
      headerActions={<span className="text-xs text-slate-400">{STATE_LABEL[state]}</span>}
    >
      {lines.length === 0 && state === "live" && <p className="text-sm text-slate-400">No log entries.</p>}
      <pre
        ref={preRef}
        onScroll={handleScroll}
        className="max-h-96 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-300"
      >
        {lines.map((l) => `${l.timestamp}  ${l.message}`).join("\n")}
      </pre>
    </Collapsible>
  );
}
