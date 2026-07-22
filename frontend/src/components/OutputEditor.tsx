import type {
  FileOutput,
  IcecastOutput,
  MixerOutput,
  Output,
  PulseOutput,
  RawFileOutput,
  UdpStreamOutput,
} from "@rtl-airband-panel/parser";
import { BoolField, Field } from "./Field.js";
import { inputClass, removeButtonClass } from "./styles.js";
import { numberOrUndefined } from "../lib/number-utils.js";
import {
  defaultFileOutput,
  defaultIcecastOutput,
  defaultMixerOutput,
  defaultPulseOutput,
  defaultRawFileOutput,
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
      <BoolField label="Disable" checked={output.disable} onChange={(v) => onChange({ ...output, disable: v } as Output)} />
    </div>
  );
}

function PulseFields({ output, onChange }: { output: PulseOutput; onChange: (o: Output) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Server (optional; PulseAudio default if blank)">
        <input
          className={inputClass}
          value={output.server ?? ""}
          onChange={(e) => onChange({ ...output, server: e.target.value || undefined })}
        />
      </Field>
      <Field label="Sink (optional; PulseAudio default if blank)">
        <input
          className={inputClass}
          value={output.sink ?? ""}
          onChange={(e) => onChange({ ...output, sink: e.target.value || undefined })}
        />
      </Field>
      <Field label="Name (optional, default: rtl_airband)">
        <input
          className={inputClass}
          value={output.name ?? ""}
          onChange={(e) => onChange({ ...output, name: e.target.value || undefined })}
        />
      </Field>
      <Field label="Stream name (optional; auto-generated from freq if blank)">
        <input
          className={inputClass}
          value={output.stream_name ?? ""}
          onChange={(e) => onChange({ ...output, stream_name: e.target.value || undefined })}
        />
      </Field>
      <BoolField label="Continuous" checked={output.continuous} onChange={(v) => onChange({ ...output, continuous: v })} />
    </div>
  );
}

function FileFields({ output, onChange }: { output: FileOutput; onChange: (o: Output) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Directory">
        <input className={inputClass} value={output.directory} onChange={(e) => onChange({ ...output, directory: e.target.value })} />
      </Field>
      <Field label="Filename template">
        <input
          className={inputClass}
          value={output.filename_template}
          onChange={(e) => onChange({ ...output, filename_template: e.target.value })}
        />
      </Field>
      <Field label="Min RX seconds (only used if split_on_transmission)">
        <input
          type="number"
          step="0.1"
          className={inputClass}
          value={output.min_rx_seconds ?? ""}
          onChange={(e) => onChange({ ...output, min_rx_seconds: numberOrUndefined(e.target.value) })}
        />
      </Field>
      <Field label="Post-write script (optional)">
        <input
          className={inputClass}
          value={output.post_write_script ?? ""}
          onChange={(e) => onChange({ ...output, post_write_script: e.target.value || undefined })}
        />
      </Field>
      <BoolField label="Continuous" checked={output.continuous} onChange={(v) => onChange({ ...output, continuous: v })} />
      <BoolField
        label="Split on transmission"
        checked={output.split_on_transmission}
        onChange={(v) => onChange({ ...output, split_on_transmission: v })}
      />
      <BoolField label="Include freq" checked={output.include_freq} onChange={(v) => onChange({ ...output, include_freq: v })} />
      <BoolField label="Append" checked={output.append} onChange={(v) => onChange({ ...output, append: v })} />
      <BoolField
        label="Dated subdirectories"
        checked={output.dated_subdirectories}
        onChange={(v) => onChange({ ...output, dated_subdirectories: v })}
      />
    </div>
  );
}

function RawFileFields({ output, onChange }: { output: RawFileOutput; onChange: (o: Output) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Directory">
        <input className={inputClass} value={output.directory} onChange={(e) => onChange({ ...output, directory: e.target.value })} />
      </Field>
      <Field label="Filename template">
        <input
          className={inputClass}
          value={output.filename_template}
          onChange={(e) => onChange({ ...output, filename_template: e.target.value })}
        />
      </Field>
      <BoolField label="Continuous" checked={output.continuous} onChange={(v) => onChange({ ...output, continuous: v })} />
      <BoolField
        label="Split on transmission"
        checked={output.split_on_transmission}
        onChange={(v) => onChange({ ...output, split_on_transmission: v })}
      />
      <BoolField label="Include freq" checked={output.include_freq} onChange={(v) => onChange({ ...output, include_freq: v })} />
      <BoolField label="Append" checked={output.append} onChange={(v) => onChange({ ...output, append: v })} />
      <BoolField
        label="Dated subdirectories"
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
      <Field label="Server">
        <input className={inputClass} value={output.server} onChange={(e) => onChange({ ...output, server: e.target.value })} />
      </Field>
      <Field label="Port">
        <input
          type="number"
          className={inputClass}
          value={output.port}
          onChange={(e) => onChange({ ...output, port: Number(e.target.value) })}
        />
      </Field>
      <Field label="Mountpoint">
        <input
          className={inputClass}
          value={output.mountpoint}
          onChange={(e) => onChange({ ...output, mountpoint: e.target.value })}
        />
      </Field>
      <Field label="Username">
        <input className={inputClass} value={output.username} onChange={(e) => onChange({ ...output, username: e.target.value })} />
      </Field>
      <Field label="Password">
        <input
          type="password"
          className={inputClass}
          value={output.password}
          onChange={(e) => onChange({ ...output, password: e.target.value })}
        />
      </Field>
      <Field label="Name (optional)">
        <input
          className={inputClass}
          value={output.name ?? ""}
          onChange={(e) => onChange({ ...output, name: e.target.value || undefined })}
        />
      </Field>
      <Field label="Genre (optional)">
        <input
          className={inputClass}
          value={output.genre ?? ""}
          onChange={(e) => onChange({ ...output, genre: e.target.value || undefined })}
        />
      </Field>
      <Field label="Description (optional)">
        <input
          className={inputClass}
          value={output.description ?? ""}
          onChange={(e) => onChange({ ...output, description: e.target.value || undefined })}
        />
      </Field>
      <Field label="TLS (optional; only if built with libshout TLS support)">
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
        checked={output.send_scan_freq_tags}
        onChange={(v) => onChange({ ...output, send_scan_freq_tags: v })}
      />
    </div>
  );
}

function UdpStreamFields({ output, onChange }: { output: UdpStreamOutput; onChange: (o: Output) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Destination address">
        <input
          className={inputClass}
          value={output.dest_address}
          onChange={(e) => onChange({ ...output, dest_address: e.target.value })}
        />
      </Field>
      <Field label="Destination port (number or service name)">
        <input
          className={inputClass}
          value={output.dest_port}
          onChange={(e) => onChange({ ...output, dest_port: e.target.value })}
        />
      </Field>
      <BoolField label="Continuous" checked={output.continuous} onChange={(v) => onChange({ ...output, continuous: v })} />
    </div>
  );
}

function MixerFields({ output, onChange }: { output: MixerOutput; onChange: (o: Output) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Mixer name (must match a top-level mixer definition)">
        <input className={inputClass} value={output.name} onChange={(e) => onChange({ ...output, name: e.target.value })} />
      </Field>
      <Field label="Ampfactor (optional, default 1.0)">
        <input
          type="number"
          step="0.1"
          className={inputClass}
          value={output.ampfactor ?? ""}
          onChange={(e) => onChange({ ...output, ampfactor: numberOrUndefined(e.target.value) })}
        />
      </Field>
      <Field label="Balance (optional, -1.0 to 1.0, default 0.0)">
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
