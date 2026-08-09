import { memo, useCallback, useMemo, useRef } from "react";
import type { Output, ScanChannel } from "@rtl-airband-panel/parser";
import { BoolField, Field } from "./Field.js";
import { Collapsible } from "./Collapsible.js";
import { OutputEditor } from "./OutputEditor.js";
import { addButtonClass, inputClass, removeButtonClass, responsiveGrid2 } from "./styles.js";
import { appendItem, duplicateAt, removeAt, updateAt } from "../lib/array-utils.js";
import { defaultPulseOutput } from "../lib/defaults.js";
import {
  formatNumberList,
  formatNumberOrList,
  formatStringList,
  numberOrUndefined,
  parseNumberList,
  parseNumberOrList,
  parseStringListOrUndefined,
} from "../lib/number-utils.js";
import { CHANNEL_TOOLTIPS } from "../lib/config-descriptions.js";
import { cloneWithNewUiKeys, uiKeyOf } from "../lib/keys.js";
import { pathStartsWith } from "../lib/validation-path.js";
import type { ChannelTarget } from "../lib/channel-targets.js";

interface ScanChannelEditorProps {
  channel: ScanChannel;
  deviceIndex: number;
  channelIndex: number;
  onChange: (channel: ScanChannel) => void;
  pathPrefix: string;
  jumpTarget?: { path: string; nonce: number } | null;
  onRevealSecret?: (fieldPath: string) => Promise<string>;
  /** Every channel an output can be copied to, across the whole instance -- see OutputEditor. */
  channelTargets: ChannelTarget[];
  onCopyOutputToChannel: (output: Output, target: ChannelTarget) => void;
}

/**
 * Editor for a scan-mode device's single channel. Most fields accept either
 * one value (applied to every scanned frequency) or a comma-separated list
 * with one entry per frequency, matching RTLSDR-Airband's own config
 * grammar (e.g. `squelch_threshold = ( -30, -25, 0, -35 );`).
 */
export const ScanChannelEditor = memo(function ScanChannelEditor({
  channel,
  deviceIndex,
  channelIndex,
  onChange,
  pathPrefix,
  jumpTarget,
  onRevealSecret,
  channelTargets,
  onCopyOutputToChannel,
}: ScanChannelEditorProps) {
  const openSignal = jumpTarget && pathStartsWith(jumpTarget.path, pathPrefix) ? jumpTarget.nonce : undefined;
  // Mirrors `channel` so the output-level callbacks below can look up an output's
  // current index by its uiKeyOf key at call time -- same pattern as ChannelEditor's
  // channelRef.
  const channelRef = useRef(channel);
  channelRef.current = channel;
  const handleOutputChange = useCallback(
    (key: string | number, next: Output) => {
      const outputs = channelRef.current.outputs;
      const idx = outputs.findIndex((o, i) => uiKeyOf(o, i) === key);
      if (idx === -1) return;
      onChange({ ...channelRef.current, outputs: updateAt(outputs, idx, next) });
    },
    [onChange]
  );
  const handleOutputRemove = useCallback(
    (key: string | number) => {
      const outputs = channelRef.current.outputs;
      const idx = outputs.findIndex((o, i) => uiKeyOf(o, i) === key);
      if (idx === -1) return;
      onChange({ ...channelRef.current, outputs: removeAt(outputs, idx) });
    },
    [onChange]
  );
  const handleOutputDuplicate = useCallback(
    (key: string | number) => {
      const outputs = channelRef.current.outputs;
      const idx = outputs.findIndex((o, i) => uiKeyOf(o, i) === key);
      if (idx === -1) return;
      onChange({ ...channelRef.current, outputs: duplicateAt(outputs, idx, cloneWithNewUiKeys) });
    },
    [onChange]
  );
  // A scan channel is always index 0 within its own device, so its own targets are
  // excluded the same way ChannelEditor excludes itself. useMemo for the same
  // reason as ChannelEditor's copyTargets -- see its comment.
  const copyTargets = useMemo(
    () => channelTargets.filter((t) => !(t.deviceIndex === deviceIndex && t.channelIndex === channelIndex)),
    [channelTargets, deviceIndex, channelIndex]
  );
  return (
    <Collapsible
      openSignal={openSignal}
      className="rounded border border-slate-600 bg-slate-800 p-3"
      titleClassName="font-medium text-slate-200"
      title={`Scan channel — ${channel.freqs.length} frequencies`}
      headerActions={
        <BoolField label="Disable" tooltip={CHANNEL_TOOLTIPS.disable} checked={channel.disable} onChange={(v) => onChange({ ...channel, disable: v })} />
      }
    >
      <div className={responsiveGrid2}>
        <Field label="Frequencies, Hz (comma-separated, one per scanned frequency)" tooltip={CHANNEL_TOOLTIPS.freqs}>
          <input
            className={inputClass}
            value={formatNumberList(channel.freqs)}
            onChange={(e) => onChange({ ...channel, freqs: parseNumberList(e.target.value) })}
          />
        </Field>
        <Field label="Labels (optional, comma-separated, one per frequency)" tooltip={CHANNEL_TOOLTIPS.labels}>
          <input
            className={inputClass}
            value={formatStringList(channel.labels)}
            onChange={(e) => onChange({ ...channel, labels: parseStringListOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Modulation, applied to all (blank = default: am)" tooltip={CHANNEL_TOOLTIPS.modulation}>
          <select
            className={inputClass}
            value={channel.modulation ?? ""}
            onChange={(e) => onChange({ ...channel, modulation: e.target.value || undefined })}
          >
            <option value="">(default)</option>
            <option value="nfm">nfm</option>
            <option value="am">am</option>
          </select>
        </Field>
        <Field label="Modulations (optional, comma-separated per frequency; overrides Modulation above)" tooltip={CHANNEL_TOOLTIPS.modulations}>
          <input
            className={inputClass}
            value={formatStringList(channel.modulations)}
            onChange={(e) => onChange({ ...channel, modulations: parseStringListOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="AFC (blank = default: 0)" tooltip={CHANNEL_TOOLTIPS.afc}>
          <input
            type="number"
            className={inputClass}
            value={channel.afc ?? ""}
            onChange={(e) => onChange({ ...channel, afc: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <NumberOrListField label="Bandwidth, Hz (single value or comma-separated per frequency)" tooltip={CHANNEL_TOOLTIPS.bandwidth} value={channel.bandwidth} onChange={(v) => onChange({ ...channel, bandwidth: v })} />
        <NumberOrListField label="Ampfactor (single value or comma-separated per frequency)" tooltip={CHANNEL_TOOLTIPS.ampfactor} value={channel.ampfactor} onChange={(v) => onChange({ ...channel, ampfactor: v })} />
        <NumberOrListField label="CTCSS Hz (single value or comma-separated; 0.0 disables for that frequency)" tooltip={CHANNEL_TOOLTIPS.ctcss} value={channel.ctcss} onChange={(v) => onChange({ ...channel, ctcss: v })} />
        <NumberOrListField label="Notch Hz (single value or comma-separated; 0.0 keeps default for that frequency)" tooltip={CHANNEL_TOOLTIPS.notch} value={channel.notch} onChange={(v) => onChange({ ...channel, notch: v })} />
        <NumberOrListField label="Notch Q (single value or comma-separated, default 10.0)" tooltip={CHANNEL_TOOLTIPS.notchQ} value={channel.notch_q} onChange={(v) => onChange({ ...channel, notch_q: v })} />
        <NumberOrListField
          label="Squelch threshold, dBFS (single value or comma-separated; 0 = auto-squelch for that frequency)"
          tooltip={CHANNEL_TOOLTIPS.squelchThreshold}
          value={channel.squelch_threshold}
          onChange={(v) => onChange({ ...channel, squelch_threshold: v })}
        />
        <NumberOrListField
          label="Squelch SNR threshold (single value or comma-separated; 0 = always open, -1.0 = keep default, per frequency)"
          tooltip={CHANNEL_TOOLTIPS.squelchSnrThreshold}
          value={channel.squelch_snr_threshold}
          onChange={(v) => onChange({ ...channel, squelch_snr_threshold: v })}
        />
        <Field label="Highpass (optional, default 100; 0 disables)" tooltip={CHANNEL_TOOLTIPS.highpass}>
          <input
            type="number"
            className={inputClass}
            value={channel.highpass ?? ""}
            onChange={(e) => onChange({ ...channel, highpass: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Lowpass (optional, default 2500; 0 disables)" tooltip={CHANNEL_TOOLTIPS.lowpass}>
          <input
            type="number"
            className={inputClass}
            value={channel.lowpass ?? ""}
            onChange={(e) => onChange({ ...channel, lowpass: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Tau, µs (optional)" tooltip={CHANNEL_TOOLTIPS.tauChannel}>
          <input
            type="number"
            className={inputClass}
            value={channel.tau ?? ""}
            onChange={(e) => onChange({ ...channel, tau: numberOrUndefined(e.target.value) })}
          />
        </Field>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between">
          <h5 className="text-sm font-medium text-slate-400">Outputs (shared across all scanned frequencies)</h5>
          <button
            type="button"
            className={addButtonClass}
            onClick={() => onChange({ ...channel, outputs: appendItem(channel.outputs, defaultPulseOutput()) })}
          >
            + Add output
          </button>
        </div>
        {channel.outputs.map((output, i) => (
          <OutputEditor
            key={uiKeyOf(output, i)}
            output={output}
            outputIndex={i}
            onChange={handleOutputChange}
            onRemove={handleOutputRemove}
            onDuplicate={handleOutputDuplicate}
            pathPrefix={`${pathPrefix}.outputs[${i}]`}
            jumpTarget={jumpTarget}
            onRevealSecret={onRevealSecret}
            channelTargets={copyTargets}
            onCopyOutputToChannel={onCopyOutputToChannel}
          />
        ))}
      </div>
    </Collapsible>
  );
});

function NumberOrListField({
  label,
  tooltip,
  value,
  onChange,
}: {
  label: string;
  tooltip?: string;
  value: number | number[] | undefined;
  onChange: (value: number | number[] | undefined) => void;
}) {
  return (
    <Field label={label} tooltip={tooltip}>
      <input className={inputClass} value={formatNumberOrList(value)} onChange={(e) => onChange(parseNumberOrList(e.target.value))} />
    </Field>
  );
}
