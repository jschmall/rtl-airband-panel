import type { Channel } from "@rtl-airband-panel/parser";
import { Field } from "./Field.js";
import { OutputEditor } from "./OutputEditor.js";
import { addButtonClass, inputClass, removeButtonClass } from "./styles.js";
import { appendItem, removeAt, updateAt } from "../lib/array-utils.js";
import { defaultPulseOutput } from "../lib/defaults.js";
import { numberOrUndefined } from "../lib/number-utils.js";

interface ChannelEditorProps {
  channel: Channel;
  onChange: (channel: Channel) => void;
  onRemove: () => void;
}

export function ChannelEditor({ channel, onChange, onRemove }: ChannelEditorProps) {
  return (
    <div className="space-y-3 rounded border border-slate-600 bg-slate-800 p-3">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-slate-200">Channel {(channel.freq / 1e6).toFixed(4)} MHz</h4>
        <button type="button" onClick={onRemove} className={removeButtonClass}>
          Remove channel
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Field label="Frequency (Hz)">
          <input
            type="number"
            className={inputClass}
            value={channel.freq}
            onChange={(e) => onChange({ ...channel, freq: Number(e.target.value) })}
          />
        </Field>
        <Field label="Modulation (blank = default: am)">
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
        <Field label="AFC (blank = default: 0)">
          <input
            type="number"
            className={inputClass}
            value={channel.afc ?? ""}
            onChange={(e) => onChange({ ...channel, afc: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Bandwidth (Hz, optional)">
          <input
            type="number"
            className={inputClass}
            value={channel.bandwidth ?? ""}
            onChange={(e) => onChange({ ...channel, bandwidth: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Ampfactor (optional)">
          <input
            type="number"
            step="0.1"
            className={inputClass}
            value={channel.ampfactor ?? ""}
            onChange={(e) => onChange({ ...channel, ampfactor: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="CTCSS Hz (optional)">
          <input
            type="number"
            step="0.1"
            className={inputClass}
            value={channel.ctcss ?? ""}
            onChange={(e) => onChange({ ...channel, ctcss: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Notch Hz (optional)">
          <input
            type="number"
            step="0.1"
            className={inputClass}
            value={channel.notch ?? ""}
            onChange={(e) => onChange({ ...channel, notch: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Squelch SNR threshold (optional)">
          <input
            type="number"
            className={inputClass}
            value={channel.squelch_snr_threshold ?? ""}
            onChange={(e) => onChange({ ...channel, squelch_snr_threshold: numberOrUndefined(e.target.value) })}
          />
        </Field>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h5 className="text-sm font-medium text-slate-400">Outputs</h5>
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
