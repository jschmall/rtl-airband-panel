import { useCallback, useMemo, useRef, type ReactNode } from "react";
import type { Device, Output, RtlAirbandConfig } from "@rtl-airband-panel/parser";
import { BoolField, Field } from "./Field.js";
import { DeviceEditor } from "./DeviceEditor.js";
import { MixerEditor } from "./MixerEditor.js";
import { addButtonClass, inputClass } from "./styles.js";
import { appendItem, duplicateAt, removeAt, updateAt } from "../lib/array-utils.js";
import { defaultDevice, defaultMixer } from "../lib/defaults.js";
import { numberOrUndefined } from "../lib/number-utils.js";
import { GLOBAL_TOOLTIPS } from "../lib/config-descriptions.js";
import { cloneWithNewUiKeys, uiKeyOf } from "../lib/keys.js";
import { buildChannelTargets, type ChannelTarget } from "../lib/channel-targets.js";

interface ConfigEditorProps {
  config: RtlAirbandConfig;
  onChange: (config: RtlAirbandConfig) => void;
  /** A validation issue the user clicked, to auto-expand and scroll to. See InstanceEditPage. */
  jumpTarget?: { path: string; nonce: number } | null;
  onRevealSecret?: (fieldPath: string) => Promise<string>;
  /** Rendered between the global settings grid and the device list -- e.g. InstanceEditPage's log viewer. */
  afterGlobalSettings?: ReactNode;
}

export function ConfigEditor({ config, onChange, jumpTarget, onRevealSecret, afterGlobalSettings }: ConfigEditorProps) {
  // Kept alongside the plain `config` prop so callbacks below can be built with
  // useCallback (stable across renders where the thing they depend on didn't
  // change) while still always reading the *current* config when they run --
  // see handleCopyOutputToChannel, which needs both properties at once.
  const configRef = useRef(config);
  configRef.current = config;

  // buildChannelTargets is cheap (just a flatten over one instance's own
  // devices/channels), but config.devices gets a new array identity on every
  // edit anywhere in the tree, not just edits that actually change a target's
  // label -- so a plain useMemo keyed on config.devices would still hand every
  // device/mixer editor a new channelTargets reference on every keystroke.
  // Comparing against the previous result and reusing its identity when
  // nothing actually changed keeps that prop stable for the (common) case of
  // editing something that isn't a channel's identifying freq/label.
  const channelTargetsRef = useRef<ChannelTarget[]>([]);
  const channelTargets = useMemo(() => {
    const next = buildChannelTargets(config.devices);
    if (JSON.stringify(next) === JSON.stringify(channelTargetsRef.current)) {
      return channelTargetsRef.current;
    }
    channelTargetsRef.current = next;
    return next;
  }, [config.devices]);

  // Appends a copy of `output` onto the target channel's outputs -- used by the
  // "Copy to channel…" action on every OutputEditor (channel and mixer outputs alike).
  // Always appends, never replaces, mirroring how "Duplicate output" behaves. Reads
  // configRef instead of closing over `config` directly so this callback's own
  // identity stays stable across renders (only `onChange` can ever change it).
  const handleCopyOutputToChannel = useCallback(
    (output: Output, target: ChannelTarget) => {
      const current = configRef.current;
      const targetDevice = current.devices[target.deviceIndex];
      if (!targetDevice) return;
      const targetChannel = targetDevice.channels[target.channelIndex];
      if (!targetChannel) return;
      const nextDevice = {
        ...targetDevice,
        channels: updateAt(targetDevice.channels, target.channelIndex, {
          ...targetChannel,
          outputs: appendItem(targetChannel.outputs, cloneWithNewUiKeys(output)),
        }),
      };
      onChange({ ...current, devices: updateAt(current.devices, target.deviceIndex, nextDevice) });
    },
    [onChange]
  );

  // Three stable callbacks (not one closure per device) so DeviceEditor's React.memo
  // can actually bail out on siblings -- each looks up the device's current index by
  // its uiKeyOf key via configRef at call time, rather than the .map() capturing the
  // index directly (which would rebuild a fresh function per device, per render).
  const handleDeviceChange = useCallback(
    (key: string | number, next: Device) => {
      const devices = configRef.current.devices;
      const idx = devices.findIndex((d, i) => uiKeyOf(d, i) === key);
      if (idx === -1) return;
      onChange({ ...configRef.current, devices: updateAt(devices, idx, next) });
    },
    [onChange]
  );
  const handleDeviceRemove = useCallback(
    (key: string | number) => {
      const devices = configRef.current.devices;
      const idx = devices.findIndex((d, i) => uiKeyOf(d, i) === key);
      if (idx === -1) return;
      onChange({ ...configRef.current, devices: removeAt(devices, idx) });
    },
    [onChange]
  );
  const handleDeviceDuplicate = useCallback(
    (key: string | number) => {
      const devices = configRef.current.devices;
      const idx = devices.findIndex((d, i) => uiKeyOf(d, i) === key);
      if (idx === -1) return;
      onChange({ ...configRef.current, devices: duplicateAt(devices, idx, cloneWithNewUiKeys) });
    },
    [onChange]
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-700 bg-slate-900/60 p-4 md:grid-cols-2">
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
        <Field label="Stats HTTP address (optional, fork build only)" tooltip={GLOBAL_TOOLTIPS.statsHttpAddress}>
          <input
            className={inputClass}
            value={config.stats_http_address ?? ""}
            onChange={(e) => onChange({ ...config, stats_http_address: e.target.value || undefined })}
          />
        </Field>
        <Field label="Stats HTTP port (optional, fork build only)" tooltip={GLOBAL_TOOLTIPS.statsHttpPort}>
          <input
            type="number"
            min="1"
            max="65535"
            className={inputClass}
            value={config.stats_http_port ?? ""}
            onChange={(e) => onChange({ ...config, stats_http_port: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Rdio-scanner queue depth (optional, fork build only, default 64)" tooltip={GLOBAL_TOOLTIPS.rdioScannerQueueDepth}>
          <input
            type="number"
            min="1"
            className={inputClass}
            value={config.rdio_scanner_queue_depth ?? ""}
            onChange={(e) => onChange({ ...config, rdio_scanner_queue_depth: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Control socket path (optional, dynamic_reload fork build only)" tooltip={GLOBAL_TOOLTIPS.controlSocketPath}>
          <input
            className={inputClass}
            value={config.control_socket_path ?? ""}
            onChange={(e) => onChange({ ...config, control_socket_path: e.target.value || undefined })}
          />
        </Field>
        <div className="grid grid-cols-1 gap-x-4 gap-y-2 self-end md:grid-cols-2">
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

      {afterGlobalSettings}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between">
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
            deviceIndex={i}
            onChange={handleDeviceChange}
            onRemove={handleDeviceRemove}
            onDuplicate={handleDeviceDuplicate}
            pathPrefix={`$.devices[${i}]`}
            jumpTarget={jumpTarget}
            onRevealSecret={onRevealSecret}
            channelTargets={channelTargets}
            onCopyOutputToChannel={handleCopyOutputToChannel}
          />
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between">
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
            onRevealSecret={onRevealSecret}
            channelTargets={channelTargets}
            onCopyOutputToChannel={handleCopyOutputToChannel}
          />
        ))}
      </div>
    </div>
  );
}
