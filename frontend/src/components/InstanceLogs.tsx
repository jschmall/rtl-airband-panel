import { useEffect, useRef, useState } from "react";
import { logsStreamUrl, type LogLine } from "../api/client.js";
import { Collapsible } from "./Collapsible.js";
import { BoolField } from "./Field.js";
import { INSTANCE_OPTIONS_TOOLTIPS } from "../lib/config-descriptions.js";

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

/** The fork's -j single-line JSON log record shape (backend/api/src/unit-template.ts, jsonLogging option). */
interface ForkJsonLogRecord {
  level?: string;
  message?: string;
}

/**
 * Renders one log line for display. When jsonLogging is on, each journal
 * line's `message` is itself the fork's JSON-encoded record -- parse it and
 * show its `level`/`message` instead of the raw JSON text. Falls back to the
 * raw line on a parse failure (e.g. a line from before a just-toggled -j
 * flag actually took effect), rather than showing nothing.
 */
function formatLine(line: LogLine, jsonLogging: boolean): string {
  if (jsonLogging) {
    try {
      const parsed = JSON.parse(line.message) as ForkJsonLogRecord;
      if (typeof parsed.message === "string") {
        const level = typeof parsed.level === "string" ? `[${parsed.level}] ` : "";
        return `${line.timestamp}  ${level}${parsed.message}`;
      }
    } catch {
      // not JSON -- fall through to the raw line below
    }
  }
  return `${line.timestamp}  ${line.message}`;
}

interface InstanceLogsProps {
  name: string;
  jsonLogging: boolean;
  jsonLoggingPending: boolean;
  onToggleJsonLogging: (next: boolean) => void;
}

export function InstanceLogs({ name, jsonLogging, jsonLoggingPending, onToggleJsonLogging }: InstanceLogsProps) {
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
      headerActions={
        // role="status"/aria-live announces connect/disconnect/error transitions to a
        // screen reader -- deliberately not applied to the <pre> below, which would
        // announce every appended line as it streams in.
        <span className="text-xs text-slate-400" role="status" aria-live="polite">
          {STATE_LABEL[state]}
        </span>
      }
    >
      <BoolField
        label={jsonLoggingPending ? "JSON logging (restarting…)" : "JSON logging"}
        tooltip={INSTANCE_OPTIONS_TOOLTIPS.jsonLogging}
        checked={jsonLogging}
        onChange={onToggleJsonLogging}
      />
      {lines.length === 0 && state === "live" && <p className="text-sm text-slate-400">No log entries.</p>}
      <pre
        ref={preRef}
        onScroll={handleScroll}
        aria-label="Live log output"
        className="max-h-96 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-300"
      >
        {lines.map((l) => formatLine(l, jsonLogging)).join("\n")}
      </pre>
    </Collapsible>
  );
}
