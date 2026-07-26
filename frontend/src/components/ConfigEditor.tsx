import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import { BoolField, Field } from "./Field.js";
import { DeviceEditor } from "./DeviceEditor.js";
import { MixerEditor } from "./MixerEditor.js";
import { addButtonClass, inputClass } from "./styles.js";
import { appendItem, duplicateAt, removeAt, updateAt } from "../lib/array-utils.js";
import { defaultDevice, defaultMixer } from "../lib/defaults.js";
import { numberOrUndefined } from "../lib/number-utils.js";
import { GLOBAL_TOOLTIPS } from "../lib/config-descriptions.js";
import { cloneWithNewUiKeys, uiKeyOf } from "../lib/keys.js";

interface ConfigEditorProps {
  config: RtlAirbandConfig;
  onChange: (config: RtlAirbandConfig) => void;
  /** A validation issue the user clicked, to auto-expand and scroll to. See InstanceEditPage. */
  jumpTarget?: { path: string; nonce: number } | null;
}

export function ConfigEditor({ config, onChange, jumpTarget }: ConfigEditorProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-700 bg-slate-900/60 p-4">
        <Field label="Stats filepath" tooltip={GLOBAL_TOOLTIPS.statsFilepath}>
          <input
            className={inputClass}
            value={config.stats_filepath}
            onChange={(e) => onChange({ ...config, stats_filepath: e.target.value })}
          />
        </Field>
        <Field label="FFT size (optional, power of two 256-8192)" tooltip={GLOBAL_TOOLTIPS.fftSize}>
          <input
            type="number"
            className={inputClass}
            value={config.fft_size ?? ""}
            onChange={(e) => onChange({ ...config, fft_size: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </Field>
        <Field label="PID file (optional, default /run/rtl_airband.pid)" tooltip={GLOBAL_TOOLTIPS.pidfile}>
          <input
            className={inputClass}
            value={config.pidfile ?? ""}
            onChange={(e) => onChange({ ...config, pidfile: e.target.value || undefined })}
          />
        </Field>
        <Field label="Shout metadata delay, seconds (optional, 0-32, default 3)" tooltip={GLOBAL_TOOLTIPS.shoutMetadataDelay}>
          <input
            type="number"
            min="0"
            max="32"
            className={inputClass}
            value={config.shout_metadata_delay ?? ""}
            onChange={(e) => onChange({ ...config, shout_metadata_delay: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Tau, µs (optional; global NFM deemphasis, default 200)" tooltip={GLOBAL_TOOLTIPS.tau}>
          <input
            type="number"
            className={inputClass}
            value={config.tau ?? ""}
            onChange={(e) => onChange({ ...config, tau: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 self-end">
          <BoolField
            label="Multiple demod threads"
            tooltip={GLOBAL_TOOLTIPS.multipleDemodThreads}
            checked={config.multiple_demod_threads}
            onChange={(v) => onChange({ ...config, multiple_demod_threads: v })}
          />
          <BoolField
            label="Multiple output threads"
            tooltip={GLOBAL_TOOLTIPS.multipleOutputThreads}
            checked={config.multiple_output_threads}
            onChange={(v) => onChange({ ...config, multiple_output_threads: v })}
          />
          <BoolField label="Localtime" tooltip={GLOBAL_TOOLTIPS.localtime} checked={config.localtime} onChange={(v) => onChange({ ...config, localtime: v })} />
          <BoolField
            label="Log scan activity"
            tooltip={GLOBAL_TOOLTIPS.logScanActivity}
            checked={config.log_scan_activity ?? false}
            onChange={(v) => onChange({ ...config, log_scan_activity: v })}
          />
        </div>
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
            key={uiKeyOf(device, i)}
            device={device}
            onChange={(next) => onChange({ ...config, devices: updateAt(config.devices, i, next) })}
            onRemove={() => onChange({ ...config, devices: removeAt(config.devices, i) })}
            onDuplicate={() => onChange({ ...config, devices: duplicateAt(config.devices, i, cloneWithNewUiKeys) })}
            pathPrefix={`$.devices[${i}]`}
            jumpTarget={jumpTarget}
          />
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-100">Mixers</h2>
          <button
            type="button"
            className={addButtonClass}
            onClick={() => onChange({ ...config, mixers: appendItem(config.mixers ?? [], defaultMixer()) })}
          >
            + Add mixer
          </button>
        </div>
        {(config.mixers ?? []).map((mixer, i) => (
          <MixerEditor
            key={uiKeyOf(mixer, i)}
            mixer={mixer}
            onChange={(next) => onChange({ ...config, mixers: updateAt(config.mixers ?? [], i, next) })}
            onRemove={() => onChange({ ...config, mixers: removeAt(config.mixers ?? [], i) })}
            // A mixer's name is how channel outputs of type "mixer" reference it -- a raw clone
            // would create two mixers answering to the same name, so blank it on the copy and
            // let the "Add mixer" empty-name convention prompt the user to pick a new one.
            onDuplicate={() => onChange({ ...config, mixers: duplicateAt(config.mixers ?? [], i, (m) => ({ ...cloneWithNewUiKeys(m), name: "" })) })}
            pathPrefix={`$.mixers[${i}]`}
            jumpTarget={jumpTarget}
          />
        ))}
      </div>
    </div>
  );
}
