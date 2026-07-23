import type {
  FileOutput,
  IcecastOutput,
  MixerOutput,
  Output,
  PulseOutput,
  RawFileOutput,
  RdioScannerConfig,
  UdpStreamOutput,
} from "@rtl-airband-panel/parser";
import { BoolField, Field } from "./Field.js";
import { inputClass, removeButtonClass } from "./styles.js";
import { numberOrUndefined } from "../lib/number-utils.js";
import { OUTPUT_TOOLTIPS } from "../lib/config-descriptions.js";
import {
  defaultFileOutput,
  defaultIcecastOutput,
  defaultMixerOutput,
  defaultPulseOutput,
  defaultRawFileOutput,
  defaultRdioScannerConfig,
  defaultUdpStreamOutput,
} from "../lib/defaults.js";

interface OutputEditorProps {
  output: Output;
  onChange: (output: Output) => void;
  onRemove: () => void;
  /** A mixer's own outputs cannot themselves be of type "mixer" (RTLSDR-Airband disallows nesting). */
  excludeMixerType?: boolean;
}

const OUTPUT_TYPE_DEFAULTS: Record<Output["type"], () => Output> = {
  pulse: defaultPulseOutput,
  file: defaultFileOutput,
  rawfile: defaultRawFileOutput,
  icecast: defaultIcecastOutput,
  udp_stream: defaultUdpStreamOutput,
  mixer: defaultMixerOutput,
};

export function OutputEditor({ output, onChange, onRemove, excludeMixerType }: OutputEditorProps) {
  return (
    <div className="space-y-2 rounded border border-slate-600 bg-slate-700 p-3">
      <div className="flex items-center justify-between">
        <Field label="Output type">
          <select
            className={inputClass}
            value={output.type}
            onChange={(e) => onChange(OUTPUT_TYPE_DEFAULTS[e.target.value as Output["type"]]())}
          >
            <option value="pulse">pulse</option>
            <option value="file">file</option>
            <option value="rawfile">rawfile</option>
            <option value="icecast">icecast</option>
            <option value="udp_stream">udp_stream</option>
            {!excludeMixerType && <option value="mixer">mixer</option>}
          </select>
        </Field>
        <button type="button" onClick={onRemove} className={removeButtonClass}>
          Remove output
        </button>
      </div>

      {output.type === "pulse" && <PulseFields output={output} onChange={onChange} />}
      {output.type === "file" && <FileFields output={output} onChange={onChange} />}
      {output.type === "rawfile" && <RawFileFields output={output} onChange={onChange} />}
      {output.type === "icecast" && <IcecastFields output={output} onChange={onChange} />}
      {output.type === "udp_stream" && <UdpStreamFields output={output} onChange={onChange} />}
      {output.type === "mixer" && <MixerFields output={output} onChange={onChange} />}
      <BoolField label="Disable" tooltip={OUTPUT_TOOLTIPS.disable} checked={output.disable} onChange={(v) => onChange({ ...output, disable: v } as Output)} />
    </div>
  );
}

function PulseFields({ output, onChange }: { output: PulseOutput; onChange: (o: Output) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Server (optional; PulseAudio default if blank)" tooltip={OUTPUT_TOOLTIPS.pulseServer}>
        <input
          className={inputClass}
          value={output.server ?? ""}
          onChange={(e) => onChange({ ...output, server: e.target.value || undefined })}
        />
      </Field>
      <Field label="Sink (optional; PulseAudio default if blank)" tooltip={OUTPUT_TOOLTIPS.pulseSink}>
        <input
          className={inputClass}
          value={output.sink ?? ""}
          onChange={(e) => onChange({ ...output, sink: e.target.value || undefined })}
        />
      </Field>
      <Field label="Name (optional, default: rtl_airband)" tooltip={OUTPUT_TOOLTIPS.pulseName}>
        <input
          className={inputClass}
          value={output.name ?? ""}
          onChange={(e) => onChange({ ...output, name: e.target.value || undefined })}
        />
      </Field>
      <Field label="Stream name (optional; auto-generated from freq if blank)" tooltip={OUTPUT_TOOLTIPS.streamName}>
        <input
          className={inputClass}
          value={output.stream_name ?? ""}
          onChange={(e) => onChange({ ...output, stream_name: e.target.value || undefined })}
        />
      </Field>
      <BoolField label="Continuous" tooltip={OUTPUT_TOOLTIPS.continuous} checked={output.continuous} onChange={(v) => onChange({ ...output, continuous: v })} />
    </div>
  );
}

function FileFields({ output, onChange }: { output: FileOutput; onChange: (o: Output) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Directory" tooltip={OUTPUT_TOOLTIPS.fileDirectory}>
        <input className={inputClass} value={output.directory} onChange={(e) => onChange({ ...output, directory: e.target.value })} />
      </Field>
      <Field label="Filename template" tooltip={OUTPUT_TOOLTIPS.filenameTemplate}>
        <input
          className={inputClass}
          value={output.filename_template}
          onChange={(e) => onChange({ ...output, filename_template: e.target.value })}
        />
      </Field>
      <Field label="Min RX seconds (only used if split_on_transmission)" tooltip={OUTPUT_TOOLTIPS.minRxSeconds}>
        <input
          type="number"
          step="0.1"
          className={inputClass}
          value={output.min_rx_seconds ?? ""}
          onChange={(e) => onChange({ ...output, min_rx_seconds: numberOrUndefined(e.target.value) })}
        />
      </Field>
      <Field label="Post-write script (optional)" tooltip={OUTPUT_TOOLTIPS.postWriteScript}>
        <input
          className={inputClass}
          value={output.post_write_script ?? ""}
          onChange={(e) => onChange({ ...output, post_write_script: e.target.value || undefined })}
        />
      </Field>
      <BoolField label="Continuous" tooltip={OUTPUT_TOOLTIPS.continuous} checked={output.continuous} onChange={(v) => onChange({ ...output, continuous: v })} />
      <BoolField
        label="Split on transmission"
        tooltip={OUTPUT_TOOLTIPS.splitOnTransmission}
        checked={output.split_on_transmission}
        onChange={(v) => onChange({ ...output, split_on_transmission: v })}
      />
      <BoolField label="Include freq" tooltip={OUTPUT_TOOLTIPS.includeFreq} checked={output.include_freq} onChange={(v) => onChange({ ...output, include_freq: v })} />
      <BoolField label="Append" tooltip={OUTPUT_TOOLTIPS.append} checked={output.append} onChange={(v) => onChange({ ...output, append: v })} />
      <BoolField
        label="Dated subdirectories"
        tooltip={OUTPUT_TOOLTIPS.datedSubdirectories}
        checked={output.dated_subdirectories}
        onChange={(v) => onChange({ ...output, dated_subdirectories: v })}
      />
      <div className="col-span-2 space-y-2 rounded border border-slate-600 bg-slate-800 p-3">
        <BoolField
          label="Upload to rdio-scanner"
          tooltip={OUTPUT_TOOLTIPS.rdioScannerEnabled}
          checked={output.rdio_scanner !== undefined}
          onChange={(v) => onChange({ ...output, rdio_scanner: v ? defaultRdioScannerConfig() : undefined })}
        />
        {output.rdio_scanner !== undefined && (
          <RdioScannerFields
            config={output.rdio_scanner}
            onChange={(rdio_scanner) => onChange({ ...output, rdio_scanner })}
          />
        )}
      </div>
    </div>
  );
}

function RdioScannerFields({ config, onChange }: { config: RdioScannerConfig; onChange: (c: RdioScannerConfig) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Server" tooltip={OUTPUT_TOOLTIPS.rdioScannerServer}>
        <input className={inputClass} value={config.server} onChange={(e) => onChange({ ...config, server: e.target.value })} />
      </Field>
      <Field label="Port" tooltip={OUTPUT_TOOLTIPS.rdioScannerPort}>
        <input
          type="number"
          className={inputClass}
          value={config.port}
          onChange={(e) => onChange({ ...config, port: Number(e.target.value) })}
        />
      </Field>
      <Field label="API key" tooltip={OUTPUT_TOOLTIPS.rdioScannerApiKey}>
        <input
          type="password"
          className={inputClass}
          value={config.api_key}
          onChange={(e) => onChange({ ...config, api_key: e.target.value })}
        />
      </Field>
      <Field label="Talkgroup ID" tooltip={OUTPUT_TOOLTIPS.rdioScannerTalkgroupId}>
        <input
          type="number"
          className={inputClass}
          value={config.talkgroup_id}
          onChange={(e) => onChange({ ...config, talkgroup_id: Number(e.target.value) })}
        />
      </Field>
      <Field label="System ID (optional)" tooltip={OUTPUT_TOOLTIPS.rdioScannerSystemId}>
        <input
          type="number"
          className={inputClass}
          value={config.system_id ?? ""}
          onChange={(e) => onChange({ ...config, system_id: numberOrUndefined(e.target.value) })}
        />
      </Field>
      <Field label="System label (optional)" tooltip={OUTPUT_TOOLTIPS.rdioScannerSystemLabel}>
        <input
          className={inputClass}
          value={config.system_label ?? ""}
          onChange={(e) => onChange({ ...config, system_label: e.target.value || undefined })}
        />
      </Field>
      <Field label="Talkgroup label (optional)" tooltip={OUTPUT_TOOLTIPS.rdioScannerTalkgroupLabel}>
        <input
          className={inputClass}
          value={config.talkgroup_label ?? ""}
          onChange={(e) => onChange({ ...config, talkgroup_label: e.target.value || undefined })}
        />
      </Field>
      <Field label="Talkgroup tag (optional)" tooltip={OUTPUT_TOOLTIPS.rdioScannerTalkgroupTag}>
        <input
          className={inputClass}
          value={config.talkgroup_tag ?? ""}
          onChange={(e) => onChange({ ...config, talkgroup_tag: e.target.value || undefined })}
        />
      </Field>
      <Field label="Talkgroup group (optional)" tooltip={OUTPUT_TOOLTIPS.rdioScannerTalkgroupGroup}>
        <input
          className={inputClass}
          value={config.talkgroup_group ?? ""}
          onChange={(e) => onChange({ ...config, talkgroup_group: e.target.value || undefined })}
        />
      </Field>
      <Field label="Source ID (optional, default 0)" tooltip={OUTPUT_TOOLTIPS.rdioScannerSourceId}>
        <input
          type="number"
          className={inputClass}
          value={config.source_id ?? ""}
          onChange={(e) => onChange({ ...config, source_id: numberOrUndefined(e.target.value) })}
        />
      </Field>
      <Field label="Timeout, ms (optional, default 5000)" tooltip={OUTPUT_TOOLTIPS.rdioScannerTimeoutMs}>
        <input
          type="number"
          className={inputClass}
          value={config.timeout_ms ?? ""}
          onChange={(e) => onChange({ ...config, timeout_ms: numberOrUndefined(e.target.value) })}
        />
      </Field>
      <Field label="Max retries (optional, default 2)" tooltip={OUTPUT_TOOLTIPS.rdioScannerMaxRetries}>
        <input
          type="number"
          className={inputClass}
          value={config.max_retries ?? ""}
          onChange={(e) => onChange({ ...config, max_retries: numberOrUndefined(e.target.value) })}
        />
      </Field>
      <BoolField
        label="Use TLS"
        tooltip={OUTPUT_TOOLTIPS.rdioScannerUseTls}
        checked={config.use_tls}
        onChange={(v) => onChange({ ...config, use_tls: v })}
      />
      <BoolField
        label="Delete local file after upload"
        tooltip={OUTPUT_TOOLTIPS.rdioScannerDeleteAfterUpload}
        checked={config.delete_after_upload}
        onChange={(v) => onChange({ ...config, delete_after_upload: v })}
      />
    </div>
  );
}

function RawFileFields({ output, onChange }: { output: RawFileOutput; onChange: (o: Output) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Directory" tooltip={OUTPUT_TOOLTIPS.fileDirectory}>
        <input className={inputClass} value={output.directory} onChange={(e) => onChange({ ...output, directory: e.target.value })} />
      </Field>
      <Field label="Filename template" tooltip={OUTPUT_TOOLTIPS.filenameTemplate}>
        <input
          className={inputClass}
          value={output.filename_template}
          onChange={(e) => onChange({ ...output, filename_template: e.target.value })}
        />
      </Field>
      <BoolField label="Continuous" tooltip={OUTPUT_TOOLTIPS.continuous} checked={output.continuous} onChange={(v) => onChange({ ...output, continuous: v })} />
      <BoolField
        label="Split on transmission"
        tooltip={OUTPUT_TOOLTIPS.splitOnTransmission}
        checked={output.split_on_transmission}
        onChange={(v) => onChange({ ...output, split_on_transmission: v })}
      />
      <BoolField label="Include freq" tooltip={OUTPUT_TOOLTIPS.includeFreq} checked={output.include_freq} onChange={(v) => onChange({ ...output, include_freq: v })} />
      <BoolField label="Append" tooltip={OUTPUT_TOOLTIPS.append} checked={output.append} onChange={(v) => onChange({ ...output, append: v })} />
      <BoolField
        label="Dated subdirectories"
        tooltip={OUTPUT_TOOLTIPS.datedSubdirectories}
        checked={output.dated_subdirectories}
        onChange={(v) => onChange({ ...output, dated_subdirectories: v })}
      />
    </div>
  );
}

const TLS_OPTIONS = ["", "auto", "auto_no_plain", "transport", "upgrade", "disabled"] as const;

function IcecastFields({ output, onChange }: { output: IcecastOutput; onChange: (o: Output) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Server" tooltip={OUTPUT_TOOLTIPS.icecastServer}>
        <input className={inputClass} value={output.server} onChange={(e) => onChange({ ...output, server: e.target.value })} />
      </Field>
      <Field label="Port" tooltip={OUTPUT_TOOLTIPS.port}>
        <input
          type="number"
          className={inputClass}
          value={output.port}
          onChange={(e) => onChange({ ...output, port: Number(e.target.value) })}
        />
      </Field>
      <Field label="Mountpoint" tooltip={OUTPUT_TOOLTIPS.mountpoint}>
        <input
          className={inputClass}
          value={output.mountpoint}
          onChange={(e) => onChange({ ...output, mountpoint: e.target.value })}
        />
      </Field>
      <Field label="Username" tooltip={OUTPUT_TOOLTIPS.username}>
        <input className={inputClass} value={output.username} onChange={(e) => onChange({ ...output, username: e.target.value })} />
      </Field>
      <Field label="Password" tooltip={OUTPUT_TOOLTIPS.password}>
        <input
          type="password"
          className={inputClass}
          value={output.password}
          onChange={(e) => onChange({ ...output, password: e.target.value })}
        />
      </Field>
      <Field label="Name (optional)" tooltip={OUTPUT_TOOLTIPS.icecastName}>
        <input
          className={inputClass}
          value={output.name ?? ""}
          onChange={(e) => onChange({ ...output, name: e.target.value || undefined })}
        />
      </Field>
      <Field label="Genre (optional)" tooltip={OUTPUT_TOOLTIPS.genre}>
        <input
          className={inputClass}
          value={output.genre ?? ""}
          onChange={(e) => onChange({ ...output, genre: e.target.value || undefined })}
        />
      </Field>
      <Field label="Description (optional)" tooltip={OUTPUT_TOOLTIPS.description}>
        <input
          className={inputClass}
          value={output.description ?? ""}
          onChange={(e) => onChange({ ...output, description: e.target.value || undefined })}
        />
      </Field>
      <Field label="TLS (optional; only if built with libshout TLS support)" tooltip={OUTPUT_TOOLTIPS.tls}>
        <select
          className={inputClass}
          value={output.tls ?? ""}
          onChange={(e) =>
            onChange({ ...output, tls: (e.target.value || undefined) as IcecastOutput["tls"] })
          }
        >
          {TLS_OPTIONS.map((mode) => (
            <option key={mode} value={mode}>
              {mode === "" ? "(default: disabled)" : mode}
            </option>
          ))}
        </select>
      </Field>
      <BoolField
        label="Send scan freq tags"
        tooltip={OUTPUT_TOOLTIPS.sendScanFreqTags}
        checked={output.send_scan_freq_tags}
        onChange={(v) => onChange({ ...output, send_scan_freq_tags: v })}
      />
    </div>
  );
}

function UdpStreamFields({ output, onChange }: { output: UdpStreamOutput; onChange: (o: Output) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Destination address" tooltip={OUTPUT_TOOLTIPS.destAddress}>
        <input
          className={inputClass}
          value={output.dest_address}
          onChange={(e) => onChange({ ...output, dest_address: e.target.value })}
        />
      </Field>
      <Field label="Destination port (number or service name)" tooltip={OUTPUT_TOOLTIPS.destPort}>
        <input
          className={inputClass}
          value={output.dest_port}
          onChange={(e) => onChange({ ...output, dest_port: e.target.value })}
        />
      </Field>
      <BoolField label="Continuous" tooltip={OUTPUT_TOOLTIPS.continuous} checked={output.continuous} onChange={(v) => onChange({ ...output, continuous: v })} />
    </div>
  );
}

function MixerFields({ output, onChange }: { output: MixerOutput; onChange: (o: Output) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Mixer name (must match a top-level mixer definition)" tooltip={OUTPUT_TOOLTIPS.mixerName}>
        <input className={inputClass} value={output.name} onChange={(e) => onChange({ ...output, name: e.target.value })} />
      </Field>
      <Field label="Ampfactor (optional, default 1.0)" tooltip={OUTPUT_TOOLTIPS.mixerAmpfactor}>
        <input
          type="number"
          step="0.1"
          className={inputClass}
          value={output.ampfactor ?? ""}
          onChange={(e) => onChange({ ...output, ampfactor: numberOrUndefined(e.target.value) })}
        />
      </Field>
      <Field label="Balance (optional, -1.0 to 1.0, default 0.0)" tooltip={OUTPUT_TOOLTIPS.balance}>
        <input
          type="number"
          step="0.1"
          min="-1"
          max="1"
          className={inputClass}
          value={output.balance ?? ""}
          onChange={(e) => onChange({ ...output, balance: numberOrUndefined(e.target.value) })}
        />
      </Field>
    </div>
  );
}
