import { useState } from "react";
import type { StatSample } from "../../api/client.js";
import { deviceMetricTooltip } from "../../lib/stats-descriptions.js";
import { titleCaseMetric } from "../../lib/stats-format.js";
import type { MixerLookups } from "../../lib/stats-mixer-labels.js";
import { Tooltip } from "../Tooltip.js";

interface MixerStatsProps {
  /** Non-channel latest samples (device + mixer counters), unfiltered -- this picks out the mixer-labeled ones itself. */
  samples: StatSample[];
  mixerLookups: MixerLookups;
}

interface MixerInputRow {
  key: string;
  inputIndex: number;
  label: string;
  value: number;
}

interface MixerOutputCounterRow {
  key: string;
  metric: string;
  output: string;
  value: number;
}

interface MixerGroup {
  mixerIndex: string;
  mixerName: string;
  outputOverruns: number;
  inputs: MixerInputRow[];
  /** Every other mixer/output-labeled counter (icecast/lame/file/udp_stream/pulse/rdio_scanner health, added alongside output_overrun_count) -- see OUTPUT_FAILURE_METRICS for which of these count as an actual failure. */
  otherOutputCounters: MixerOutputCounterRow[];
}

/**
 * Mirrors backend/api/src/stats/stats-service.ts's OUTPUT_FAILURE_METRICS --
 * kept in sync by hand since stats types aren't shared between the two
 * workspaces (see stats-descriptions.ts / stats-format.ts for the same
 * pattern). Drives the collapsed card's "N output failures" flag, same
 * exclusions as the landing-page outputFailureTotal rollup: backlog-exceeded
 * is a subset of disconnect, pulse underflow/overflow are expected under
 * normal load.
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

function buildMixerGroups(samples: StatSample[], lookups: MixerLookups): MixerGroup[] {
  const groups = new Map<string, MixerGroup>();
  const getGroup = (mixerIndex: string): MixerGroup => {
    let group = groups.get(mixerIndex);
    if (!group) {
      group = {
        mixerIndex,
        mixerName: lookups.mixerNames.get(mixerIndex) ?? mixerIndex,
        outputOverruns: 0,
        inputs: [],
        otherOutputCounters: [],
      };
      groups.set(mixerIndex, group);
    }
    return group;
  };

  for (const sample of samples) {
    const mixerIndex = sample.labels["mixer"];
    if (mixerIndex === undefined) continue;

    if (sample.metric === "output_overrun_count") {
      getGroup(mixerIndex).outputOverruns = sample.value;
    } else if (sample.metric === "input_overrun_count") {
      const inputIndexText = sample.labels["input"];
      if (inputIndexText === undefined) continue;
      const inputIndex = Number(inputIndexText);
      const label = lookups.inputChannels.get(`${mixerIndex}:${inputIndexText}`) ?? `Input ${inputIndexText}`;
      getGroup(mixerIndex).inputs.push({ key: `${mixerIndex}:${inputIndexText}`, inputIndex, label, value: sample.value });
    } else {
      const output = sample.labels["output"];
      if (output === undefined) continue;
      getGroup(mixerIndex).otherOutputCounters.push({ key: `${output}:${sample.metric}`, metric: sample.metric, output, value: sample.value });
    }
  }

  for (const group of groups.values()) {
    group.inputs.sort((a, b) => a.inputIndex - b.inputIndex);
    group.otherOutputCounters.sort((a, b) => a.output.localeCompare(b.output) || a.metric.localeCompare(b.metric));
  }

  return [...groups.values()].sort((a, b) => Number(a.mixerIndex) - Number(b.mixerIndex));
}

function outputFailureTotal(group: MixerGroup): number {
  return group.otherOutputCounters.filter((c) => OUTPUT_FAILURE_METRICS.has(c.metric)).reduce((sum, c) => sum + c.value, 0);
}

function MixerGroupCard({ group }: { group: MixerGroup }) {
  const [expanded, setExpanded] = useState(false);
  const inputsWithDrops = group.inputs.filter((i) => i.value > 0).length;
  const failureTotal = outputFailureTotal(group);

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-4">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-between gap-3 text-left">
        <span className="font-medium text-slate-200">
          <span className="mr-1 inline-block w-3 text-slate-500">{expanded ? "▾" : "▸"}</span>
          Mixer {group.mixerName}
        </span>
        <span className="shrink-0 text-xs text-slate-400">
          Output overruns:{" "}
          <span className={group.outputOverruns > 0 ? "font-semibold text-amber-300" : "text-slate-200"}>{group.outputOverruns}</span>
          {group.inputs.length > 0 && (
            <>
              {", "}
              <span className={inputsWithDrops > 0 ? "font-semibold text-amber-300" : "text-slate-200"}>{inputsWithDrops}</span> of{" "}
              {group.inputs.length} input{group.inputs.length === 1 ? "" : "s"} dropping
            </>
          )}
          {group.otherOutputCounters.length > 0 && (
            <>
              {", "}
              <span className={failureTotal > 0 ? "font-semibold text-amber-300" : "text-slate-200"}>{failureTotal}</span> output failure
              {failureTotal === 1 ? "" : "s"}
            </>
          )}
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

/** Per-mixer output/input overrun counters, collapsed to a one-line summary by default so a healthy mixer with many inputs doesn't dominate the page -- expand to see the full per-input breakdown. */
export function MixerStats({ samples, mixerLookups }: MixerStatsProps) {
  const groups = buildMixerGroups(samples, mixerLookups);
  if (groups.length === 0) return null;

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium text-slate-400">Mixer stats</h2>
      <div className="space-y-2">
        {groups.map((group) => (
          <MixerGroupCard key={group.mixerIndex} group={group} />
        ))}
      </div>
    </div>
  );
}
