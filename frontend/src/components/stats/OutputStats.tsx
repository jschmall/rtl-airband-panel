import { useState, type ReactElement } from "react";
import type { StatSample } from "../../api/client.js";
import { deviceMetricTooltip } from "../../lib/stats-descriptions.js";
import { titleCaseMetric } from "../../lib/stats-format.js";
import type { MixerLookups } from "../../lib/stats-mixer-labels.js";
import { Tooltip } from "../Tooltip.js";

interface OutputStatsProps {
  /** Non-channel latest samples (device + mixer counters), unfiltered -- this picks out the mixer/device-channel/process-wide-labeled ones itself. */
  samples: StatSample[];
  mixerLookups: MixerLookups;
}

interface MixerInputRow {
  key: string;
  inputIndex: number;
  label: string;
  value: number;
}

interface OutputCounterRow {
  key: string;
  metric: string;
  output: string;
  value: number;
}

type OutputGroupKind = "mixer" | "device-channel" | "process-wide";

interface OutputGroup {
  key: string;
  kind: OutputGroupKind;
  title: string;
  /** Only ever set for kind === "mixer" -- device-channel/process-wide groups have no overrun figure to show. */
  outputOverruns: number | undefined;
  /** Only ever populated for kind === "mixer". */
  inputs: MixerInputRow[];
  /** Every other mixer/device-channel/process-wide-labeled counter (icecast/lame/file/udp_stream/pulse/rdio_scanner health, added alongside output_overrun_count) -- see OUTPUT_FAILURE_METRICS for which of these count as an actual failure. */
  otherOutputCounters: OutputCounterRow[];
}

/**
 * Mirrors backend/api/src/stats/stats-service.ts's OUTPUT_FAILURE_METRICS --
 * kept in sync by hand since stats types aren't shared between the two
 * workspaces (see stats-descriptions.ts / stats-format.ts for the same
 * pattern). Drives the collapsed card's "N output failures" flag, same
 * exclusions as the landing-page outputFailureTotal rollup: backlog-exceeded
 * is a subset of disconnect, pulse underflow/overflow are expected under
 * normal load. Also used to catch the rdio_scanner_* counters, which are
 * process-wide and may carry no `output` label at all.
 */
const OUTPUT_FAILURE_METRICS = new Set([
  "icecast_disconnect_count",
  "lame_encode_failure_count",
  "file_write_failure_count",
  "udp_stream_dropped_packet_count",
  "pulse_disconnect_count",
  "rdio_scanner_queue_drop_count",
  "rdio_scanner_upload_failure_count",
]);

/**
 * True for any sample OutputStats groups into a card, so callers (the Stats
 * page's flat device-counter tile grid) know not to also render it as its
 * own tile. Single source of truth for "what counts as an output counter",
 * shared with buildOutputGroups below so the two can't drift apart.
 */
export function isOutputCounterSample(sample: StatSample): boolean {
  if (sample.labels["mixer"] !== undefined) return true;
  if (sample.metric === "output_overrun_count" || sample.metric === "buffer_overflow_count" || sample.metric === "buffer_underrun_count") {
    return false;
  }
  return sample.labels["output"] !== undefined || OUTPUT_FAILURE_METRICS.has(sample.metric);
}

function buildOutputGroups(samples: StatSample[], lookups: MixerLookups): OutputGroup[] {
  const groups = new Map<string, OutputGroup>();
  const getGroup = (key: string, kind: OutputGroupKind, title: string): OutputGroup => {
    let group = groups.get(key);
    if (!group) {
      group = { key, kind, title, outputOverruns: undefined, inputs: [], otherOutputCounters: [] };
      groups.set(key, group);
    }
    return group;
  };

  for (const sample of samples) {
    const mixerIndex = sample.labels["mixer"];

    if (mixerIndex !== undefined) {
      const group = getGroup(`mixer:${mixerIndex}`, "mixer", `Mixer ${lookups.mixerNames.get(mixerIndex) ?? mixerIndex}`);
      if (sample.metric === "output_overrun_count") {
        group.outputOverruns = sample.value;
      } else if (sample.metric === "input_overrun_count") {
        const inputIndexText = sample.labels["input"];
        if (inputIndexText === undefined) continue;
        const inputIndex = Number(inputIndexText);
        const label = lookups.inputChannels.get(`${mixerIndex}:${inputIndexText}`) ?? `Input ${inputIndexText}`;
        group.inputs.push({ key: `${mixerIndex}:${inputIndexText}`, inputIndex, label, value: sample.value });
      } else {
        const output = sample.labels["output"];
        if (output === undefined) continue;
        group.otherOutputCounters.push({ key: `${output}:${sample.metric}`, metric: sample.metric, output, value: sample.value });
      }
      continue;
    }

    // Not mixer-labeled. Buffer health and device-level output overruns are
    // owned by the Stats page's existing flat-tile / buffer-health
    // rendering -- this component must not touch them.
    if (sample.metric === "output_overrun_count" || sample.metric === "buffer_overflow_count" || sample.metric === "buffer_underrun_count") {
      continue;
    }

    const output = sample.labels["output"];
    if (output === undefined && !OUTPUT_FAILURE_METRICS.has(sample.metric)) continue;

    const device = sample.labels["device"];
    const channel = sample.labels["channel"];
    const group =
      device !== undefined && channel !== undefined
        ? getGroup(`device:${device}:channel:${channel}`, "device-channel", `Device ${device}, Channel ${channel}`)
        : getGroup("process-wide", "process-wide", "Process-wide");
    group.otherOutputCounters.push({ key: `${output ?? "none"}:${sample.metric}`, metric: sample.metric, output: output ?? "—", value: sample.value });
  }

  for (const group of groups.values()) {
    group.inputs.sort((a, b) => a.inputIndex - b.inputIndex);
    group.otherOutputCounters.sort((a, b) => a.output.localeCompare(b.output) || a.metric.localeCompare(b.metric));
  }

  const kindOrder: Record<OutputGroupKind, number> = { mixer: 0, "device-channel": 1, "process-wide": 2 };
  return [...groups.values()].sort(
    (a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.title.localeCompare(b.title, undefined, { numeric: true })
  );
}

function outputFailureTotal(group: OutputGroup): number {
  return group.otherOutputCounters.filter((c) => OUTPUT_FAILURE_METRICS.has(c.metric)).reduce((sum, c) => sum + c.value, 0);
}

function OutputGroupCard({ group }: { group: OutputGroup }) {
  const [expanded, setExpanded] = useState(false);
  const inputsWithDrops = group.inputs.filter((i) => i.value > 0).length;
  const failureTotal = outputFailureTotal(group);

  const summaryParts = [
    group.outputOverruns !== undefined && (
      <span key="overruns">
        Output overruns:{" "}
        <span className={group.outputOverruns > 0 ? "font-semibold text-amber-300" : "text-slate-200"}>{group.outputOverruns}</span>
      </span>
    ),
    group.inputs.length > 0 && (
      <span key="inputs">
        <span className={inputsWithDrops > 0 ? "font-semibold text-amber-300" : "text-slate-200"}>{inputsWithDrops}</span> of{" "}
        {group.inputs.length} input{group.inputs.length === 1 ? "" : "s"} dropping
      </span>
    ),
    group.otherOutputCounters.length > 0 && (
      <span key="failures">
        <span className={failureTotal > 0 ? "font-semibold text-amber-300" : "text-slate-200"}>{failureTotal}</span> output failure
        {failureTotal === 1 ? "" : "s"}
      </span>
    ),
  ].filter((part): part is ReactElement => Boolean(part));

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-4">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-between gap-3 text-left">
        <span className="font-medium text-slate-200">
          <span className="mr-1 inline-block w-3 text-slate-500">{expanded ? "▾" : "▸"}</span>
          {group.title}
        </span>
        <span className="shrink-0 text-xs text-slate-400">
          {summaryParts.map((part, i) => (
            <span key={part.key}>
              {i > 0 && ", "}
              {part}
            </span>
          ))}
        </span>
      </button>

      {expanded && (group.inputs.length > 0 || group.otherOutputCounters.length > 0) && (
        <div className="mt-3 space-y-3 border-t border-slate-800 pt-3">
          {group.inputs.length > 0 && (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-slate-400">
                  <th className="py-1 pr-4">Input</th>
                  <th className="py-1 pr-4 text-right">Overruns</th>
                </tr>
              </thead>
              <tbody>
                {group.inputs.map((input) => (
                  <tr key={input.key} className="border-t border-slate-800 text-slate-300">
                    <td className="py-1 pr-4">{input.label}</td>
                    <td className={`py-1 pr-4 text-right tabular-nums ${input.value > 0 ? "font-semibold text-amber-300" : ""}`}>
                      {input.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {group.otherOutputCounters.length > 0 && (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-slate-400">
                  <th className="py-1 pr-4">Output counter</th>
                  <th className="py-1 pr-4">Output</th>
                  <th className="py-1 pr-4 text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {group.otherOutputCounters.map((counter) => {
                  const tooltip = deviceMetricTooltip(counter.metric);
                  const label = titleCaseMetric(counter.metric);
                  return (
                    <tr key={counter.key} className="border-t border-slate-800 text-slate-300">
                      <td className="py-1 pr-4">
                        {tooltip ? (
                          <Tooltip content={tooltip} className="cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2">
                            {label}
                          </Tooltip>
                        ) : (
                          label
                        )}
                      </td>
                      <td className="py-1 pr-4">{counter.output}</td>
                      <td className={`py-1 pr-4 text-right tabular-nums ${counter.value > 0 ? "font-semibold text-amber-300" : ""}`}>
                        {counter.value}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Per-mixer, per-channel-output, and process-wide output/input health
 * counters, collapsed to a one-line summary by default so an instance with
 * many channels/outputs doesn't dominate the page with one tile per
 * metric -- expand a card to see its full breakdown.
 */
export function OutputStats({ samples, mixerLookups }: OutputStatsProps) {
  const groups = buildOutputGroups(samples, mixerLookups);
  if (groups.length === 0) return null;

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium text-slate-400">Output stats</h2>
      <div className="space-y-2">
        {groups.map((group) => (
          <OutputGroupCard key={group.key} group={group} />
        ))}
      </div>
    </div>
  );
}
