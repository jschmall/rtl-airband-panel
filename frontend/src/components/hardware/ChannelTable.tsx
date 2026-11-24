import type { ChannelHealth } from "../../api/client.js";
import { useNarrow } from "../../lib/use-media.js";
import { formatDb, formatSigned } from "../../lib/hardware-format.js";

function Squelch({ open }: { open: boolean }) {
  return open ? (
    <span className="flex items-center gap-1.5 text-emerald-300">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      open
    </span>
  ) : (
    <span className="text-slate-500">closed</span>
  );
}

function ChannelName({ c, scan }: { c: ChannelHealth; scan: boolean }) {
  return (
    <>
      {c.label ?? <span className="text-slate-500">#{c.channel}</span>}
      {!c.enabled && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-slate-500">disabled</span>}
      {scan && c.active && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-sky-300">tuned</span>}
    </>
  );
}

const dimmed = (c: ChannelHealth) => (!c.enabled || !c.active ? "text-slate-500" : "");

/** The same readings for a phone held upright, where the table's columns don't fit: two lines a channel. */
function ChannelList({ channels, scan }: { channels: ChannelHealth[]; scan: boolean }) {
  const reading = (label: string, value: string) => (
    <div className="flex gap-1">
      <dt className="text-slate-500">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
  return (
    <ul className="text-xs tabular-nums text-slate-200">
      {channels.map((c) => (
        <li key={`${c.channel}-${c.freqHz}`} className={`border-b border-slate-800/60 py-2 ${dimmed(c)}`}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 break-words font-medium">
              <ChannelName c={c} scan={scan} />
            </span>
            <span className="flex flex-shrink-0 items-baseline gap-3">
              {(c.freqHz / 1e6).toFixed(4)}
              <Squelch open={c.squelchOpen} />
            </span>
          </div>
          <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-slate-300">
            {reading("Signal", formatDb(c.signalDbfs, "dBFS"))}
            {reading("Noise", formatDb(c.noiseDbfs, "dBFS"))}
            {reading("SNR", formatDb(c.snrDb))}
            {c.freqOffsetHz !== null && reading("Offset", formatSigned(c.freqOffsetHz, "Hz", 0))}
          </dl>
        </li>
      ))}
    </ul>
  );
}

/** Per-frequency readings for one SDR. Scan channels list every frequency, with the tuned one marked. */
export function ChannelTable({ channels, scan }: { channels: ChannelHealth[]; scan: boolean }) {
  const narrow = useNarrow();
  if (channels.length === 0) return <p className="text-xs text-slate-500">No channels.</p>;
  if (narrow) return <ChannelList channels={channels} scan={scan} />;
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
            <tr key={`${c.channel}-${c.freqHz}`} className={`border-b border-slate-800/60 ${dimmed(c)}`}>
              <td className="py-1.5 pr-3">
                <ChannelName c={c} scan={scan} />
              </td>
              <td className="py-1.5 pr-3">{(c.freqHz / 1e6).toFixed(4)}</td>
              <td className="py-1.5 pr-3">
                <Squelch open={c.squelchOpen} />
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
