import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import { Field } from "./Field.js";
import { DeviceEditor } from "./DeviceEditor.js";
import { addButtonClass, checkboxClass, inputClass } from "./styles.js";
import { appendItem, removeAt, updateAt } from "../lib/array-utils.js";
import { defaultDevice } from "../lib/defaults.js";

interface ConfigEditorProps {
  config: RtlAirbandConfig;
  onChange: (config: RtlAirbandConfig) => void;
}

export function ConfigEditor({ config, onChange }: ConfigEditorProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-700 bg-slate-900/60 p-4">
        <Field label="Stats filepath">
          <input
            className={inputClass}
            value={config.stats_filepath}
            onChange={(e) => onChange({ ...config, stats_filepath: e.target.value })}
          />
        </Field>
        <Field label="FFT size (optional, power of two 256-8192)">
          <input
            type="number"
            className={inputClass}
            value={config.fft_size ?? ""}
            onChange={(e) => onChange({ ...config, fft_size: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={config.multiple_demod_threads}
            onChange={(e) => onChange({ ...config, multiple_demod_threads: e.target.checked })}
          />
          Multiple demod threads
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={config.multiple_output_threads}
            onChange={(e) => onChange({ ...config, multiple_output_threads: e.target.checked })}
          />
          Multiple output threads
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={config.localtime}
            onChange={(e) => onChange({ ...config, localtime: e.target.checked })}
          />
          Localtime
        </label>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-100">Devices</h2>
          <button
            type="button"
            className={addButtonClass}
            onClick={() => onChange({ ...config, devices: appendItem(config.devices, defaultDevice()) })}
          >
            + Add device
          </button>
        </div>
        {config.devices.map((device, i) => (
          <DeviceEditor
            key={i}
            device={device}
            onChange={(next) => onChange({ ...config, devices: updateAt(config.devices, i, next) })}
            onRemove={() => onChange({ ...config, devices: removeAt(config.devices, i) })}
          />
        ))}
      </div>
    </div>
  );
}
