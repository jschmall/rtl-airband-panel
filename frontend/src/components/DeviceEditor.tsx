import type { Device } from "@rtl-airband-panel/parser";
import { Field } from "./Field.js";
import { ChannelEditor } from "./ChannelEditor.js";
import { addButtonClass, inputClass, removeButtonClass } from "./styles.js";
import { appendItem, removeAt, updateAt } from "../lib/array-utils.js";
import { defaultChannel } from "../lib/defaults.js";
import { numberOrUndefined } from "../lib/number-utils.js";

interface DeviceEditorProps {
  device: Device;
  onChange: (device: Device) => void;
  onRemove: () => void;
}

export function DeviceEditor({ device, onChange, onRemove }: DeviceEditorProps) {
  return (
    <div className="space-y-4 rounded-lg border border-slate-700 bg-slate-900 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-100">
          Device — {device.type} ({(device.centerfreq / 1e6).toFixed(3)} MHz)
        </h3>
        <button type="button" onClick={onRemove} className={removeButtonClass}>
          Remove device
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Field label="Type">
          <input className={inputClass} value={device.type} onChange={(e) => onChange({ ...device, type: e.target.value })} />
        </Field>
        <Field label="Serial (optional if index is set)">
          <input
            className={inputClass}
            value={device.serial ?? ""}
            onChange={(e) => onChange({ ...device, serial: e.target.value || undefined })}
          />
        </Field>
        <Field label="Index (optional, used if serial is blank; default 0)">
          <input
            type="number"
            className={inputClass}
            value={device.index ?? ""}
            onChange={(e) => onChange({ ...device, index: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Gain">
          <input
            type="number"
            className={inputClass}
            value={device.gain}
            onChange={(e) => onChange({ ...device, gain: Number(e.target.value) })}
          />
        </Field>
        <Field label="Center frequency (Hz)">
          <input
            type="number"
            className={inputClass}
            value={device.centerfreq}
            onChange={(e) => onChange({ ...device, centerfreq: Number(e.target.value) })}
          />
        </Field>
        <Field label="Sample rate (Hz, blank = default 2,560,000)">
          <input
            type="number"
            className={inputClass}
            value={device.sample_rate ?? ""}
            onChange={(e) => onChange({ ...device, sample_rate: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Correction (ppm, blank = default 0)">
          <input
            type="number"
            className={inputClass}
            value={device.correction ?? ""}
            onChange={(e) => onChange({ ...device, correction: numberOrUndefined(e.target.value) })}
          />
        </Field>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-slate-300">Channels</h4>
          <button
            type="button"
            className={addButtonClass}
            onClick={() => onChange({ ...device, channels: appendItem(device.channels, defaultChannel()) })}
          >
            + Add channel
          </button>
        </div>
        {device.channels.map((channel, i) => (
          <ChannelEditor
            key={i}
            channel={channel}
            onChange={(next) => onChange({ ...device, channels: updateAt(device.channels, i, next) })}
            onRemove={() => onChange({ ...device, channels: removeAt(device.channels, i) })}
          />
        ))}
      </div>
    </div>
  );
}
