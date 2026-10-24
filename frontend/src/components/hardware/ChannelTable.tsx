import type { ChannelHealth } from "../../api/client.js";
import { formatDb, formatSigned } from "../../lib/hardware-format.js";

/** Per-frequency readings for one SDR. Scan channels list every frequency, with the tuned one marked. */
export function ChannelTable({ channels, scan }: { channels: ChannelHealth[]; scan: boolean }) {
  if (channels.length === 0) return <p className="text-xs text-slate-500">No channels.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-left text-xs">
        <thead className="text-slate-400">
          <tr className="border-b border-slate-800">
            <th className="py-1.5 pr-3 font-medium">Channel</th>
            <th className="py-1.5 pr-3 font-medium">Frequency</th>
            <th className="py-1.5 pr-3 font-medium">Squelch</th>
            <th className="py-1.5 pr-3 text-right font-medium">Signal</th>
            <th className="py-1.5 pr-3 text-right font-medium">Noise</th>
            <th className="py-1.5 pr-3 text-right font-medium">SNR</th>
            <th className="py-1.5 text-right font-medium">Offset</th>
          </tr>
        </thead>
        <tbody className="tabular-nums text-slate-200">
          {channels.map((c) => (
            <tr key={`${c.channel}-${c.freqHz}`} className={`border-b border-slate-800/60 ${!c.enabled || !c.active ? "text-slate-500" : ""}`}>
              <td className="py-1.5 pr-3">
                {c.label ?? <span className="text-slate-500">#{c.channel}</span>}
                {!c.enabled && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-slate-500">disabled</span>}
                {scan && c.active && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-sky-300">tuned</span>}
              </td>
              <td className="py-1.5 pr-3">{(c.freqHz / 1e6).toFixed(4)}</td>
              <td className="py-1.5 pr-3">
                {c.squelchOpen ? (
                  <span className="flex items-center gap-1.5 text-emerald-300">
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    open
                  </span>
                ) : (
                  <span className="text-slate-500">closed</span>
                )}
              </td>
              <td className="py-1.5 pr-3 text-right">{formatDb(c.signalDbfs, "dBFS")}</td>
              <td className="py-1.5 pr-3 text-right">{formatDb(c.noiseDbfs, "dBFS")}</td>
              <td className="py-1.5 pr-3 text-right">{formatDb(c.snrDb)}</td>
              <td className="py-1.5 text-right" title={c.freqOffsetPpm === null ? undefined : formatSigned(c.freqOffsetPpm, "ppm", 2)}>
                {c.freqOffsetHz === null ? <span className="text-slate-500">—</span> : formatSigned(c.freqOffsetHz, "Hz", 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
