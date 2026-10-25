import { memo, useState, type ReactNode } from "react";
import type { SdrHealth } from "../../api/client.js";
import {
  correctionAdvice,
  formatCount,
  formatDb,
  formatMHz,
  formatRate,
  formatSigned,
  formatSpan,
  gainAdvice,
  gainText,
  sdrEditorHref,
  sdrTitle,
  type Advice,
  type HistoryPoint,
} from "../../lib/hardware-format.js";
import { HARDWARE_TOOLTIPS } from "../../lib/stats-descriptions.js";
import { GuardedLink } from "../GuardedLink.js";
import { Tooltip } from "../Tooltip.js";
import { ChannelTable } from "./ChannelTable.js";
import { HeadroomMeter } from "./HeadroomMeter.js";
import { Sparkline } from "./Sparkline.js";

const ADVICE_STYLE: Record<Advice["tone"], { color: string; icon: ReactNode }> = {
  ok: { color: "text-emerald-300", icon: <polyline points="2.5,6.5 5,9 9.5,3.5" /> },
  // Something to change: lower the gain, fix the correction.
  warn: { color: "text-amber-300", icon: <path d="M2 6h7M6.5 3l3 3-3 3" /> },
  // Optional: room to raise the gain.
  info: { color: "text-sky-300", icon: <path d="M6 10V2.5M3 5.5l3-3 3 3" /> },
  pending: {
    color: "text-slate-400",
    icon: (
      <>
        <circle cx="6" cy="6" r="4.5" />
        <path d="M6 3.5V6l1.5 1.5" />
      </>
    ),
  },
};

function AdviceLine({ advice }: { advice: Advice }) {
  const { color, icon } = ADVICE_STYLE[advice.tone];
  return (
    <p className={`mt-1 flex items-start gap-1 text-xs font-medium ${color}`}>
      <svg aria-hidden="true" viewBox="0 0 12 12" className="mt-0.5 h-3 w-3 shrink-0 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {icon}
      </svg>
      <span>{advice.text}</span>
    </p>
  );
}

function Tile({
  label,
  tooltip,
  value,
  sub,
  advice,
  children,
}: {
  label: string;
  tooltip: string;
  value: string;
  sub?: ReactNode;
  advice?: Advice | null;
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-md border border-slate-800 bg-slate-950/40 p-3">
      <p className="text-xs text-slate-400">
        <Tooltip content={tooltip} className="cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2">
          {label}
        </Tooltip>
      </p>
      <p className="mt-0.5 truncate text-lg font-semibold tabular-nums text-slate-100">{value}</p>
      {sub && <div className="truncate text-xs text-slate-400">{sub}</div>}
      {advice && <AdviceLine advice={advice} />}
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

function Setting({ label, tooltip, value }: { label: string; tooltip: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-slate-400">
        <Tooltip content={tooltip} className="cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2">
          {label}
        </Tooltip>
      </dt>
      <dd className="tabular-nums text-slate-200">{value}</dd>
    </div>
  );
}

interface SdrCardProps {
  instance: string;
  sdr: SdrHealth;
  live: boolean;
  history: HistoryPoint[];
}

function SdrCardImpl({ instance, sdr, live, history }: SdrCardProps) {
  const [showChannels, setShowChannels] = useState(false);
  const series = (pick: (p: HistoryPoint) => number | null) => history.map((p) => ({ ts: p.ts, value: pick(p) }));
  const openCount = sdr.channels.filter((c) => c.squelchOpen).length;
  const stateBad = sdr.state !== null && sdr.state !== "running";

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900/60 p-4" aria-label={`${instance} ${sdrTitle(sdr)}`}>
      <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="font-medium text-slate-100">
          <GuardedLink to={sdrEditorHref(instance, sdr)} className="hover:text-sky-300 hover:underline decoration-slate-500 underline-offset-2" title="Edit this device's settings">
            {sdrTitle(sdr)}
          </GuardedLink>
        </h3>
        <span className="text-xs text-slate-400">
          {instance}
          {sdr.mode === "scan" ? " · scan" : ""}
        </span>
        {stateBad && (
          <span className="rounded border border-red-500/40 px-1.5 text-[11px] font-medium uppercase tracking-wide text-red-300">{sdr.state}</span>
        )}
        {live && (
          <span className="ml-auto text-xs text-slate-400">
            {openCount > 0 ? `${openCount} of ${sdr.channels.length} active` : `${sdr.channels.length} channel${sdr.channels.length === 1 ? "" : "s"}`}
          </span>
        )}
      </header>

      <dl className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        <Setting label="Center" tooltip={HARDWARE_TOOLTIPS.centerSpan} value={formatMHz(sdr.centerFreqHz)} />
        <Setting label="Span" tooltip={HARDWARE_TOOLTIPS.centerSpan} value={formatSpan(sdr.sampleRateHz)} />
        {sdr.tunerBandwidthHz !== null && <Setting label="Filter" tooltip={HARDWARE_TOOLTIPS.centerSpan} value={formatSpan(sdr.tunerBandwidthHz)} />}
        <Setting label="Gain" tooltip={HARDWARE_TOOLTIPS.gain} value={gainText(sdr)} />
        {sdr.correction !== null && (
          <Setting label="Correction" tooltip={HARDWARE_TOOLTIPS.freqError} value={`${sdr.correction} ${sdr.correctionUnit}`} />
        )}
      </dl>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Headroom"
          tooltip={HARDWARE_TOOLTIPS.headroom}
          value={formatDb(sdr.headroomDb)}
          sub={sdr.peakDbfs !== null ? `peak ${formatDb(sdr.peakDbfs, "dBFS")}` : undefined}
          advice={live ? gainAdvice(sdr, history) : null}
        >
          <HeadroomMeter peakDbfs={sdr.peakDbfs} headroomDb={sdr.headroomDb} />
          <Sparkline points={series((p) => p.headroomDb)} label="Headroom trend" format={(v) => `${v.toFixed(1)} dB`} />
        </Tile>
        <Tile label="Noise floor" tooltip={HARDWARE_TOOLTIPS.noiseFloor} value={formatDb(sdr.noiseFloorDbfs, "dBFS")}>
          <Sparkline points={series((p) => p.noiseFloorDbfs)} label="Noise floor trend" format={(v) => `${v.toFixed(1)} dBFS`} />
        </Tile>
        <Tile
          label="Frequency error"
          tooltip={HARDWARE_TOOLTIPS.freqError}
          value={formatSigned(sdr.freqErrorPpm, "ppm", 2)}
          sub={
            sdr.freqErrorSamples > 0
              ? `${sdr.freqErrorSamples} channel${sdr.freqErrorSamples === 1 ? "" : "s"}`
              : live
                ? "waiting for a transmission"
                : undefined
          }
          advice={correctionAdvice(sdr)}
        >
          <Sparkline points={series((p) => p.freqErrorPpm)} label="Frequency error trend" format={(v) => `${v.toFixed(2)} ppm`} />
        </Tile>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-1">
          <Tile
            label="Dropped samples"
            tooltip={HARDWARE_TOOLTIPS.dropped}
            value={formatCount(sdr.bufferOverflows)}
            sub={formatRate(sdr.overflowsPerSec) || undefined}
          />
          <Tile
            label="Clipped samples"
            tooltip={HARDWARE_TOOLTIPS.clipped}
            value={formatCount(sdr.clippedSamples)}
            sub={formatRate(sdr.clippedPerSec) || undefined}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => setShowChannels((v) => !v)}
        aria-expanded={showChannels}
        className="mt-3 text-xs text-sky-400 hover:text-sky-300"
      >
        {showChannels ? "Hide channels" : `Show channels (${sdr.channels.length})`}
      </button>
      {showChannels && (
        <div className="mt-2">
          <ChannelTable channels={sdr.channels} scan={sdr.mode === "scan"} />
        </div>
      )}
    </section>
  );
}

export const SdrCard = memo(SdrCardImpl);
