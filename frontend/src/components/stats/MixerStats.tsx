import { useState } from "react";
import type { StatSample } from "../../api/client.js";
import type { MixerLookups } from "../../lib/stats-mixer-labels.js";

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

interface MixerGroup {
  mixerIndex: string;
  mixerName: string;
  outputOverruns: number;
  inputs: MixerInputRow[];
}

function buildMixerGroups(samples: StatSample[], lookups: MixerLookups): MixerGroup[] {
  const groups = new Map<string, MixerGroup>();
  const getGroup = (mixerIndex: string): MixerGroup => {
    let group = groups.get(mixerIndex);
    if (!group) {
      group = { mixerIndex, mixerName: lookups.mixerNames.get(mixerIndex) ?? mixerIndex, outputOverruns: 0, inputs: [] };
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
    }
  }

  for (const group of groups.values()) {
    group.inputs.sort((a, b) => a.inputIndex - b.inputIndex);
  }

  return [...groups.values()].sort((a, b) => Number(a.mixerIndex) - Number(b.mixerIndex));
}

function MixerGroupCard({ group }: { group: MixerGroup }) {
  const [expanded, setExpanded] = useState(false);
  const inputsWithDrops = group.inputs.filter((i) => i.value > 0).length;

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
        </span>
      </button>

      {expanded && group.inputs.length > 0 && (
        <div className="mt-3 border-t border-slate-800 pt-3">
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
