import { useEffect, useMemo, useState } from "react";
import type { InstanceHardware } from "../api/client.js";
import { SdrCard } from "../components/hardware/SdrCard.js";
import { appendHistory, notLiveReason, sdrKey, type HistoryPoint } from "../lib/hardware-format.js";
import { useHardwareFeed, type FeedConnection } from "../lib/use-hardware-feed.js";
import { useInstanceList } from "../state/InstanceListContext.js";

const FEED_LABEL: Record<FeedConnection, { text: string; light: string }> = {
  connecting: { text: "Connecting…", light: "bg-slate-500" },
  live: { text: "Live", light: "bg-emerald-500" },
  polling: { text: "Polling every 2 s", light: "bg-amber-500" },
  offline: { text: "Offline", light: "bg-red-500" },
};

function InstanceSection({ instance, history }: { instance: InstanceHardware; history: ReadonlyMap<string, HistoryPoint[]> }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-slate-200">{instance.name}</h2>
        {instance.live ? (
          instance.version && <span className="text-xs text-slate-500">rtl_airband {instance.version}</span>
        ) : (
          <span className="text-xs text-amber-300">Not live: {notLiveReason(instance.reason, instance.detail)} Showing configured values.</span>
        )}
      </div>
      {instance.devices.length === 0 ? (
        <p className="text-xs text-slate-500">No devices configured.</p>
      ) : (
        instance.devices.map((sdr) => (
          <SdrCard key={sdr.index} instance={instance.name} sdr={sdr} live={instance.live} history={history.get(sdrKey(instance.name, sdr)) ?? EMPTY} />
        ))
      )}
    </div>
  );
}

const EMPTY: HistoryPoint[] = [];

/** Live per-SDR hardware health across every instance. */
export function HardwarePage() {
  const { snapshot, connection, error } = useHardwareFeed();
  const { searchQuery } = useInstanceList();
  const [history, setHistory] = useState<ReadonlyMap<string, HistoryPoint[]>>(new Map());

  useEffect(() => {
    if (!snapshot) return;
    const sdrs = snapshot.instances
      .filter((i) => i.live)
      .flatMap((i) => i.devices.map((sdr) => ({ key: sdrKey(i.name, sdr), sdr })));
    setHistory((prev) => appendHistory(prev, snapshot.sampledAtMs, sdrs));
  }, [snapshot]);

  const query = searchQuery.trim().toLowerCase();
  const instances = useMemo(
    () => (snapshot?.instances ?? []).filter((i) => !query || i.name.toLowerCase().includes(query)),
    [snapshot, query]
  );
  const feed = FEED_LABEL[connection];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Hardware</h1>
          <p className="text-sm text-slate-400">Live health of every SDR: ADC headroom, noise floor, frequency error and dropped samples.</p>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-slate-400">
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${feed.light}`} />
          {feed.text}
        </span>
      </div>
      {error && <p className="rounded bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      {snapshot === null ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : instances.length === 0 ? (
        <p className="text-sm text-slate-400">{query ? `No instance matches "${searchQuery}".` : "No instances yet."}</p>
      ) : (
        instances.map((instance) => <InstanceSection key={instance.name} instance={instance} history={history} />)
      )}
    </div>
  );
}
