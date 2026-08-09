import { memo, useCallback } from "react";
import type { MultichannelChannel, Output } from "@rtl-airband-panel/parser";
import { BoolField, Field } from "./Field.js";
import { Collapsible } from "./Collapsible.js";
import { OutputEditor } from "./OutputEditor.js";
import { addButtonClass, inputClass, removeButtonClass, responsiveGrid4 } from "./styles.js";
import { appendItem, duplicateAt, removeAt, updateAt } from "../lib/array-utils.js";
import { defaultPulseOutput } from "../lib/defaults.js";
import { numberOrUndefined } from "../lib/number-utils.js";
import { CHANNEL_TOOLTIPS } from "../lib/config-descriptions.js";
import { cloneWithNewUiKeys, uiKeyOf } from "../lib/keys.js";
import { pathStartsWith } from "../lib/validation-path.js";
import type { ChannelTarget } from "../lib/channel-targets.js";

interface ChannelEditorProps {
  channel: MultichannelChannel;
  deviceIndex: number;
  channelIndex: number;
  onChange: (key: string | number, next: MultichannelChannel) => void;
  onRemove: (key: string | number) => void;
  onDuplicate: (key: string | number) => void;
  /** True for the brief window right after this channel was created by "Duplicate channel" -- see DeviceEditor's justDuplicatedKey. */
  highlighted?: boolean;
  pathPrefix: string;
  jumpTarget?: { path: string; nonce: number } | null;
  onRevealSecret?: (fieldPath: string) => Promise<string>;
  /** Every channel an output can be copied to, across the whole instance -- see OutputEditor. */
  channelTargets: ChannelTarget[];
  onCopyOutputToChannel: (output: Output, target: ChannelTarget) => void;
}

export const ChannelEditor = memo(function ChannelEditor({
  channel,
  deviceIndex,
  channelIndex,
  onChange,
  onRemove,
  onDuplicate,
  highlighted,
  pathPrefix,
  jumpTarget,
  onRevealSecret,
  channelTargets,
  onCopyOutputToChannel,
}: ChannelEditorProps) {
  const channelKey = uiKeyOf(channel, channelIndex);
  const emitChange = useCallback((next: MultichannelChannel) => onChange(channelKey, next), [onChange, channelKey]);
  // Excludes this channel itself from its outputs' copy-target list --
  // "Duplicate output" already covers copying an output within its own channel.
  const copyTargets = channelTargets.filter((t) => !(t.deviceIndex === deviceIndex && t.channelIndex === channelIndex));
  const openSignal = jumpTarget && pathStartsWith(jumpTarget.path, pathPrefix) ? jumpTarget.nonce : undefined;
  const channelTitle = `Channel ${(channel.freq / 1e6).toFixed(4)} MHz${channel.label ? ` — ${channel.label}` : ""}`;
  return (
    <Collapsible
      openSignal={openSignal}
      className={`rounded border border-slate-600 bg-slate-800 p-3 transition-shadow duration-700 ${highlighted ? "ring-2 ring-sky-400" : ""}`}
      titleClassName="font-medium text-slate-200"
      title={
        // Truncates with an ellipsis when the header is too narrow for the full
        // frequency + label; hovering swaps to a horizontally scrollable view
        // instead of just clipping, so the full title is still reachable.
        <span
          title={channelTitle}
          className="block overflow-hidden text-ellipsis whitespace-nowrap hover:overflow-x-auto hover:text-clip"
        >
          {channelTitle}
        </span>
      }
      headerActions={
        <div className="flex items-center gap-3">
          <BoolField label="Disable" tooltip={CHANNEL_TOOLTIPS.disable} checked={channel.disable} onChange={(v) => emitChange({ ...channel, disable: v })} />
          <BoolField label="Enabled" tooltip={CHANNEL_TOOLTIPS.enabled} checked={channel.enabled ?? true} onChange={(v) => emitChange({ ...channel, enabled: v })} />
          <button type="button" onClick={() => onDuplicate(channelKey)} className={addButtonClass}>
            Duplicate channel
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Remove channel ${(channel.freq / 1e6).toFixed(4)} MHz? This also deletes all of its outputs.`)) onRemove(channelKey);
            }}
            className={removeButtonClass}
          >
            Remove channel
          </button>
        </div>
      }
    >
      <div className={responsiveGrid4}>
        <Field label="Frequency (Hz)" tooltip={CHANNEL_TOOLTIPS.freq}>
          <input
            type="number"
            className={inputClass}
            value={channel.freq}
            onChange={(e) => emitChange({ ...channel, freq: Number(e.target.value) })}
          />
        </Field>
        <Field label="Modulation (blank = default: am)" tooltip={CHANNEL_TOOLTIPS.modulation}>
          <select
            className={inputClass}
            value={channel.modulation ?? ""}
            onChange={(e) => emitChange({ ...channel, modulation: e.target.value || undefined })}
          >
            <option value="">(default)</option>
            <option value="nfm">nfm</option>
            <option value="am">am</option>
          </select>
        </Field>
        <Field label="AFC (blank = default: 0)" tooltip={CHANNEL_TOOLTIPS.afc}>
          <input
            type="number"
            className={inputClass}
            value={channel.afc ?? ""}
            onChange={(e) => emitChange({ ...channel, afc: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Bandwidth (Hz, optional)" tooltip={CHANNEL_TOOLTIPS.bandwidth}>
          <input
            type="number"
            className={inputClass}
            value={channel.bandwidth ?? ""}
            onChange={(e) => emitChange({ ...channel, bandwidth: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Ampfactor (optional)" tooltip={CHANNEL_TOOLTIPS.ampfactor}>
          <input
            type="number"
            step="0.1"
            min="0"
            className={inputClass}
            value={channel.ampfactor ?? ""}
            onChange={(e) => emitChange({ ...channel, ampfactor: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="CTCSS Hz (optional)" tooltip={CHANNEL_TOOLTIPS.ctcss}>
          <input
            type="number"
            step="0.1"
            className={inputClass}
            value={channel.ctcss ?? ""}
            onChange={(e) => emitChange({ ...channel, ctcss: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Notch Hz (optional)" tooltip={CHANNEL_TOOLTIPS.notch}>
          <input
            type="number"
            step="0.1"
            className={inputClass}
            value={channel.notch ?? ""}
            onChange={(e) => emitChange({ ...channel, notch: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Squelch SNR threshold (optional)" tooltip={CHANNEL_TOOLTIPS.squelchSnrThreshold}>
          <input
            type="number"
            className={inputClass}
            value={channel.squelch_snr_threshold ?? ""}
            onChange={(e) => emitChange({ ...channel, squelch_snr_threshold: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Squelch threshold, dBFS (optional)" tooltip={CHANNEL_TOOLTIPS.squelchThreshold}>
          <input
            type="number"
            max="0"
            className={inputClass}
            value={channel.squelch_threshold ?? ""}
            onChange={(e) => emitChange({ ...channel, squelch_threshold: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Label (optional)" tooltip={CHANNEL_TOOLTIPS.label}>
          <input
            className={inputClass}
            value={channel.label ?? ""}
            onChange={(e) => emitChange({ ...channel, label: e.target.value || undefined })}
          />
        </Field>
        <Field label="Notch Q (optional, default 10.0)" tooltip={CHANNEL_TOOLTIPS.notchQ}>
          <input
            type="number"
            step="0.1"
            min="0.1"
            className={inputClass}
            value={channel.notch_q ?? ""}
            onChange={(e) => emitChange({ ...channel, notch_q: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Highpass (optional, default 100; 0 disables)" tooltip={CHANNEL_TOOLTIPS.highpass}>
          <input
            type="number"
            className={inputClass}
            value={channel.highpass ?? ""}
            onChange={(e) => emitChange({ ...channel, highpass: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Lowpass (optional, default 2500; 0 disables)" tooltip={CHANNEL_TOOLTIPS.lowpass}>
          <input
            type="number"
            className={inputClass}
            value={channel.lowpass ?? ""}
            onChange={(e) => emitChange({ ...channel, lowpass: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Tau, µs (optional)" tooltip={CHANNEL_TOOLTIPS.tauChannel}>
          <input
            type="number"
            className={inputClass}
            value={channel.tau ?? ""}
            onChange={(e) => emitChange({ ...channel, tau: numberOrUndefined(e.target.value) })}
          />
        </Field>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between">
          <h5 className="text-sm font-medium text-slate-400">Outputs</h5>
          <button
            type="button"
            className={addButtonClass}
            onClick={() => emitChange({ ...channel, outputs: appendItem(channel.outputs, defaultPulseOutput()) })}
          >
            + Add output
          </button>
        </div>
        {channel.outputs.map((output, i) => (
          <OutputEditor
            key={uiKeyOf(output, i)}
            output={output}
            onChange={(next) => emitChange({ ...channel, outputs: updateAt(channel.outputs, i, next) })}
            onRemove={() => emitChange({ ...channel, outputs: removeAt(channel.outputs, i) })}
            onDuplicate={() => emitChange({ ...channel, outputs: duplicateAt(channel.outputs, i, cloneWithNewUiKeys) })}
            pathPrefix={`${pathPrefix}.outputs[${i}]`}
            jumpTarget={jumpTarget}
            onRevealSecret={onRevealSecret}
            channelTargets={copyTargets}
            onCopyToChannel={(target) => onCopyOutputToChannel(output, target)}
          />
        ))}
      </div>
    </Collapsible>
  );
});
