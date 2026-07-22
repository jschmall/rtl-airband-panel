import type { Channel, Device, MultichannelChannel, ScanChannel } from "@rtl-airband-panel/parser";
import { BoolField, Field } from "./Field.js";
import { ChannelEditor } from "./ChannelEditor.js";
import { ScanChannelEditor } from "./ScanChannelEditor.js";
import { addButtonClass, inputClass, removeButtonClass } from "./styles.js";
import { appendItem, removeAt, updateAt } from "../lib/array-utils.js";
import { channelsForMode, defaultChannel, defaultScanChannel } from "../lib/defaults.js";
import { numberOrUndefined } from "../lib/number-utils.js";

function isMultichannelChannel(channel: Channel): channel is MultichannelChannel {
  return "freq" in channel;
}

function isScanChannel(channel: Channel): channel is ScanChannel {
  return "freqs" in channel;
}

interface DeviceEditorProps {
  device: Device;
  onChange: (device: Device) => void;
  onRemove: () => void;
}

const DEVICE_TYPES = ["rtlsdr", "mirisdr", "soapysdr"] as const;

function gainToText(gain: number | string | undefined): string {
  return gain === undefined ? "" : String(gain);
}

/** Numeric-looking gain text (e.g. rtlsdr's "29") becomes a number; anything else (e.g. SoapySDR's "LNA=32,VGA=20") stays a string. */
function parseGain(text: string): number | string | undefined {
  if (text === "") return undefined;
  const n = Number(text);
  return Number.isFinite(n) && text.trim() !== "" ? n : text;
}

export function DeviceEditor({ device, onChange, onRemove }: DeviceEditorProps) {
  const isSoapy = device.type === "soapysdr";
  const isMiri = device.type === "mirisdr";
  const isRtl = device.type === "rtlsdr";

  return (
    <div className="space-y-4 rounded-lg border border-slate-700 bg-slate-900 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-100">
          Device — {device.type}
          {device.centerfreq !== undefined ? ` (${(device.centerfreq / 1e6).toFixed(3)} MHz)` : ""}
        </h3>
        <button type="button" onClick={onRemove} className={removeButtonClass}>
          Remove device
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Field label="Type">
          <select className={inputClass} value={device.type} onChange={(e) => onChange({ ...device, type: e.target.value })}>
            {DEVICE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Mode (blank = default: multichannel)">
          <select
            className={inputClass}
            value={device.mode ?? ""}
            onChange={(e) => {
              const mode = (e.target.value || undefined) as Device["mode"];
              onChange({ ...device, mode, channels: channelsForMode(device.channels, mode) });
            }}
          >
            <option value="">(default: multichannel)</option>
            <option value="multichannel">multichannel</option>
            <option value="scan">scan</option>
          </select>
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
        <Field label={isSoapy ? "Gain (number, or 'component=value' pairs; blank = AGC)" : "Gain"}>
          <input className={inputClass} value={gainToText(device.gain)} onChange={(e) => onChange({ ...device, gain: parseGain(e.target.value) })} />
        </Field>
        <Field label={device.mode === "scan" ? "Center frequency (Hz, not used in scan mode)" : "Center frequency (Hz)"}>
          <input
            type="number"
            className={inputClass}
            value={device.centerfreq ?? ""}
            onChange={(e) => onChange({ ...device, centerfreq: numberOrUndefined(e.target.value) })}
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
        <Field label="Tau, µs (optional; NFM deemphasis, overrides global)">
          <input
            type="number"
            className={inputClass}
            value={device.tau ?? ""}
            onChange={(e) => onChange({ ...device, tau: numberOrUndefined(e.target.value) })}
          />
        </Field>

        {isRtl && (
          <Field label="Buffers (optional, default 10)">
            <input
              type="number"
              className={inputClass}
              value={device.buffers ?? ""}
              onChange={(e) => onChange({ ...device, buffers: numberOrUndefined(e.target.value) })}
            />
          </Field>
        )}
        {isMiri && (
          <Field label="Num buffers (optional, default 10)">
            <input
              type="number"
              className={inputClass}
              value={device.num_buffers ?? ""}
              onChange={(e) => onChange({ ...device, num_buffers: numberOrUndefined(e.target.value) })}
            />
          </Field>
        )}
        {isSoapy && (
          <>
            <Field label="Device string (required, e.g. 'driver=rtlsdr,serial=00000001')">
              <input
                className={inputClass}
                value={device.device_string ?? ""}
                onChange={(e) => onChange({ ...device, device_string: e.target.value || undefined })}
              />
            </Field>
            <Field label="Channel (optional, default 0)">
              <input
                type="number"
                className={inputClass}
                value={device.channel ?? ""}
                onChange={(e) => onChange({ ...device, channel: numberOrUndefined(e.target.value) })}
              />
            </Field>
            <Field label="Antenna (optional)">
              <input
                className={inputClass}
                value={device.antenna ?? ""}
                onChange={(e) => onChange({ ...device, antenna: e.target.value || undefined })}
              />
            </Field>
          </>
        )}

        <BoolField label="Disable" checked={device.disable} onChange={(v) => onChange({ ...device, disable: v })} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-slate-300">Channels</h4>
          {device.mode !== "scan" && (
            <button
              type="button"
              className={addButtonClass}
              onClick={() => onChange({ ...device, channels: appendItem(device.channels, defaultChannel()) })}
            >
              + Add channel
            </button>
          )}
        </div>
        {device.mode === "scan" ? (
          <ScanChannelEditor
            channel={device.channels.find(isScanChannel) ?? defaultScanChannel()}
            onChange={(next) => onChange({ ...device, channels: [next] })}
          />
        ) : (
          device.channels.filter(isMultichannelChannel).map((channel, i) => (
            <ChannelEditor
              key={i}
              channel={channel}
              onChange={(next) => onChange({ ...device, channels: updateAt(device.channels, i, next) })}
              onRemove={() => onChange({ ...device, channels: removeAt(device.channels, i) })}
            />
          ))
        )}
      </div>
    </div>
  );
}
