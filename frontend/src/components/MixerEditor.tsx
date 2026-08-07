import type { Mixer, MixerRemoteInput, Output } from "@rtl-airband-panel/parser";
import { BoolField, Field } from "./Field.js";
import { Collapsible } from "./Collapsible.js";
import { OutputEditor } from "./OutputEditor.js";
import { addButtonClass, inputClass, removeButtonClass, responsiveGrid2, responsiveGrid3 } from "./styles.js";
import { appendItem, duplicateAt, removeAt, updateAt } from "../lib/array-utils.js";
import { defaultIcecastOutput, defaultMixerRemoteInput } from "../lib/defaults.js";
import { numberOrUndefined } from "../lib/number-utils.js";
import { MIXER_TOOLTIPS } from "../lib/config-descriptions.js";
import { cloneWithNewUiKeys, uiKeyOf } from "../lib/keys.js";
import { pathStartsWith } from "../lib/validation-path.js";
import type { ChannelTarget } from "../lib/channel-targets.js";

interface MixerEditorProps {
  mixer: Mixer;
  onChange: (mixer: Mixer) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  pathPrefix: string;
  jumpTarget?: { path: string; nonce: number } | null;
  onRevealSecret?: (fieldPath: string) => Promise<string>;
  /** Every channel an output can be copied to, across the whole instance -- see OutputEditor. */
  channelTargets: ChannelTarget[];
  onCopyOutputToChannel: (output: Output, target: ChannelTarget) => void;
}

/** Editor for a top-level mixer definition, which channel outputs of type "mixer" route audio into by name. */
export function MixerEditor({
  mixer,
  onChange,
  onRemove,
  onDuplicate,
  pathPrefix,
  jumpTarget,
  onRevealSecret,
  channelTargets,
  onCopyOutputToChannel,
}: MixerEditorProps) {
  const openSignal = jumpTarget && pathStartsWith(jumpTarget.path, pathPrefix) ? jumpTarget.nonce : undefined;
  return (
    <Collapsible
      openSignal={openSignal}
      className="rounded-lg border border-slate-700 bg-slate-900 p-4"
      titleClassName="text-lg font-semibold text-slate-100"
      title={`Mixer — ${mixer.name || "(unnamed)"}`}
      headerActions={
        <div className="flex items-center gap-3">
          <BoolField label="Disable" tooltip={MIXER_TOOLTIPS.disable} checked={mixer.disable} onChange={(v) => onChange({ ...mixer, disable: v })} />
          <BoolField label="Enabled" tooltip={MIXER_TOOLTIPS.enabled} checked={mixer.enabled ?? true} onChange={(v) => onChange({ ...mixer, enabled: v })} />
          <button type="button" onClick={onDuplicate} className={addButtonClass}>
            Duplicate mixer
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Remove mixer '${mixer.name || "(unnamed)"}'? This also deletes all of its outputs.`)) onRemove();
            }}
            className={removeButtonClass}
          >
            Remove mixer
          </button>
        </div>
      }
    >
      <div className={responsiveGrid3}>
        <Field label="Name (referenced by channel outputs of type 'mixer')" tooltip={MIXER_TOOLTIPS.name}>
          <input className={inputClass} value={mixer.name} onChange={(e) => onChange({ ...mixer, name: e.target.value })} />
        </Field>
        <Field label="Highpass (optional; 0 disables)" tooltip={MIXER_TOOLTIPS.highpass}>
          <input
            type="number"
            className={inputClass}
            value={mixer.highpass ?? ""}
            onChange={(e) => onChange({ ...mixer, highpass: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Lowpass (optional; 0 disables)" tooltip={MIXER_TOOLTIPS.lowpass}>
          <input
            type="number"
            className={inputClass}
            value={mixer.lowpass ?? ""}
            onChange={(e) => onChange({ ...mixer, lowpass: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Reserve inputs (optional, default 0)" tooltip={MIXER_TOOLTIPS.reserveInputs}>
          <input
            type="number"
            min="0"
            step="1"
            className={inputClass}
            value={mixer.reserve_inputs ?? ""}
            onChange={(e) => onChange({ ...mixer, reserve_inputs: numberOrUndefined(e.target.value) })}
          />
        </Field>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between">
          <h5 className="text-sm font-medium text-slate-400">Outputs</h5>
          <button
            type="button"
            className={addButtonClass}
            onClick={() => onChange({ ...mixer, outputs: appendItem(mixer.outputs, defaultIcecastOutput()) })}
          >
            + Add output
          </button>
        </div>
        {mixer.outputs.map((output, i) => (
          <OutputEditor
            key={uiKeyOf(output, i)}
            output={output}
            excludeMixerType
            onChange={(next) => onChange({ ...mixer, outputs: updateAt(mixer.outputs, i, next as Exclude<Output, { type: "mixer" }>) })}
            onRemove={() => onChange({ ...mixer, outputs: removeAt(mixer.outputs, i) })}
            onDuplicate={() => onChange({ ...mixer, outputs: duplicateAt(mixer.outputs, i, cloneWithNewUiKeys) })}
            pathPrefix={`${pathPrefix}.outputs[${i}]`}
            jumpTarget={jumpTarget}
            onRevealSecret={onRevealSecret}
            channelTargets={channelTargets}
            onCopyToChannel={(target) => onCopyOutputToChannel(output, target)}
          />
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between">
          <h5 className="text-sm font-medium text-slate-400" title={MIXER_TOOLTIPS.remoteInputsSection}>
            Remote inputs (cross-instance, fork-only)
          </h5>
          <button
            type="button"
            className={addButtonClass}
            onClick={() => onChange({ ...mixer, remote_inputs: appendItem(mixer.remote_inputs ?? [], defaultMixerRemoteInput()) })}
          >
            + Add remote input
          </button>
        </div>
        {(mixer.remote_inputs ?? []).map((input, i) => (
          <MixerRemoteInputFields
            key={uiKeyOf(input, i)}
            input={input}
            onChange={(next) => onChange({ ...mixer, remote_inputs: updateAt(mixer.remote_inputs ?? [], i, next) })}
            onRemove={() => onChange({ ...mixer, remote_inputs: removeAt(mixer.remote_inputs ?? [], i) })}
          />
        ))}
      </div>
    </Collapsible>
  );
}

function MixerRemoteInputFields({
  input,
  onChange,
  onRemove,
}: {
  input: MixerRemoteInput;
  onChange: (input: MixerRemoteInput) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2 rounded border border-slate-700 bg-slate-800 p-3">
      <div className={responsiveGrid2}>
        <Field label="Listen path" tooltip={MIXER_TOOLTIPS.remoteInputListenPath}>
          <input className={inputClass} value={input.listen_path} onChange={(e) => onChange({ ...input, listen_path: e.target.value })} />
        </Field>
        <Field label="Stream ID" tooltip={MIXER_TOOLTIPS.remoteInputStreamId}>
          <input
            type="number"
            min="0"
            step="1"
            className={inputClass}
            value={input.stream_id}
            onChange={(e) => onChange({ ...input, stream_id: e.target.value === "" ? 0 : Number(e.target.value) })}
          />
        </Field>
        <Field label="Ampfactor (optional, default 1.0)" tooltip={MIXER_TOOLTIPS.remoteInputAmpfactor}>
          <input
            type="number"
            step="0.1"
            className={inputClass}
            value={input.ampfactor ?? ""}
            onChange={(e) => onChange({ ...input, ampfactor: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Balance (optional, -1.0 to 1.0, default 0.0)" tooltip={MIXER_TOOLTIPS.remoteInputBalance}>
          <input
            type="number"
            step="0.1"
            min="-1"
            max="1"
            className={inputClass}
            value={input.balance ?? ""}
            onChange={(e) => onChange({ ...input, balance: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Label (optional)" tooltip={MIXER_TOOLTIPS.remoteInputLabel}>
          <input className={inputClass} value={input.label ?? ""} onChange={(e) => onChange({ ...input, label: e.target.value || undefined })} />
        </Field>
      </div>
      <button type="button" onClick={onRemove} className={removeButtonClass}>
        Remove remote input
      </button>
    </div>
  );
}
