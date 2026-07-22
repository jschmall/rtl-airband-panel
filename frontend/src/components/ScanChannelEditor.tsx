import type { ScanChannel } from "@rtl-airband-panel/parser";
import { BoolField, Field } from "./Field.js";
import { OutputEditor } from "./OutputEditor.js";
import { addButtonClass, inputClass, removeButtonClass } from "./styles.js";
import { appendItem, removeAt, updateAt } from "../lib/array-utils.js";
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

interface ScanChannelEditorProps {
  channel: ScanChannel;
  onChange: (channel: ScanChannel) => void;
}

/**
 * Editor for a scan-mode device's single channel. Most fields accept either
 * one value (applied to every scanned frequency) or a comma-separated list
 * with one entry per frequency, matching RTLSDR-Airband's own config
 * grammar (e.g. `squelch_threshold = ( -30, -25, 0, -35 );`).
 */
export function ScanChannelEditor({ channel, onChange }: ScanChannelEditorProps) {
  return (
    <div className="space-y-3 rounded border border-slate-600 bg-slate-800 p-3">
      <h4 className="font-medium text-slate-200">Scan channel — {channel.freqs.length} frequencies</h4>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Frequencies, Hz (comma-separated, one per scanned frequency)">
          <input
            className={inputClass}
            value={formatNumberList(channel.freqs)}
            onChange={(e) => onChange({ ...channel, freqs: parseNumberList(e.target.value) })}
          />
        </Field>
        <Field label="Labels (optional, comma-separated, one per frequency)">
          <input
            className={inputClass}
            value={formatStringList(channel.labels)}
            onChange={(e) => onChange({ ...channel, labels: parseStringListOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Modulation, applied to all (blank = default: am)">
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
        <Field label="Modulations (optional, comma-separated per frequency; overrides Modulation above)">
          <input
            className={inputClass}
            value={formatStringList(channel.modulations)}
            onChange={(e) => onChange({ ...channel, modulations: parseStringListOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="AFC (blank = default: 0)">
          <input
            type="number"
            className={inputClass}
            value={channel.afc ?? ""}
            onChange={(e) => onChange({ ...channel, afc: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <NumberOrListField label="Bandwidth, Hz (single value or comma-separated per frequency)" value={channel.bandwidth} onChange={(v) => onChange({ ...channel, bandwidth: v })} />
        <NumberOrListField label="Ampfactor (single value or comma-separated per frequency)" value={channel.ampfactor} onChange={(v) => onChange({ ...channel, ampfactor: v })} />
        <NumberOrListField label="CTCSS Hz (single value or comma-separated; 0.0 disables for that frequency)" value={channel.ctcss} onChange={(v) => onChange({ ...channel, ctcss: v })} />
        <NumberOrListField label="Notch Hz (single value or comma-separated; 0.0 keeps default for that frequency)" value={channel.notch} onChange={(v) => onChange({ ...channel, notch: v })} />
        <NumberOrListField label="Notch Q (single value or comma-separated, default 10.0)" value={channel.notch_q} onChange={(v) => onChange({ ...channel, notch_q: v })} />
        <NumberOrListField
          label="Squelch threshold, dBFS (single value or comma-separated; 0 = auto-squelch for that frequency)"
          value={channel.squelch_threshold}
          onChange={(v) => onChange({ ...channel, squelch_threshold: v })}
        />
        <NumberOrListField
          label="Squelch SNR threshold (single value or comma-separated; 0 = always open, -1.0 = keep default, per frequency)"
          value={channel.squelch_snr_threshold}
          onChange={(v) => onChange({ ...channel, squelch_snr_threshold: v })}
        />
        <Field label="Highpass Hz (optional, default 100; 0 disables)">
          <input
            type="number"
            className={inputClass}
            value={channel.highpass ?? ""}
            onChange={(e) => onChange({ ...channel, highpass: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Lowpass Hz (optional, default 2500; 0 disables)">
          <input
            type="number"
            className={inputClass}
            value={channel.lowpass ?? ""}
            onChange={(e) => onChange({ ...channel, lowpass: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Tau, µs (optional; NFM deemphasis, falls back to device/global)">
          <input
            type="number"
            className={inputClass}
            value={channel.tau ?? ""}
            onChange={(e) => onChange({ ...channel, tau: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <BoolField label="Disable" checked={channel.disable} onChange={(v) => onChange({ ...channel, disable: v })} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
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
            key={i}
            output={output}
            onChange={(next) => onChange({ ...channel, outputs: updateAt(channel.outputs, i, next) })}
            onRemove={() => onChange({ ...channel, outputs: removeAt(channel.outputs, i) })}
          />
        ))}
      </div>
    </div>
  );
}

function NumberOrListField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | number[] | undefined;
  onChange: (value: number | number[] | undefined) => void;
}) {
  return (
    <Field label={label}>
      <input className={inputClass} value={formatNumberOrList(value)} onChange={(e) => onChange(parseNumberOrList(e.target.value))} />
    </Field>
  );
}
