import type { Mixer, Output } from "@rtl-airband-panel/parser";
import { BoolField, Field } from "./Field.js";
import { Collapsible } from "./Collapsible.js";
import { OutputEditor } from "./OutputEditor.js";
import { addButtonClass, inputClass, removeButtonClass } from "./styles.js";
import { appendItem, duplicateAt, removeAt, updateAt } from "../lib/array-utils.js";
import { defaultIcecastOutput } from "../lib/defaults.js";
import { numberOrUndefined } from "../lib/number-utils.js";
import { MIXER_TOOLTIPS } from "../lib/config-descriptions.js";
import { cloneWithNewUiKeys, uiKeyOf } from "../lib/keys.js";
import { pathStartsWith } from "../lib/validation-path.js";

interface MixerEditorProps {
  mixer: Mixer;
  onChange: (mixer: Mixer) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  pathPrefix: string;
  jumpTarget?: { path: string; nonce: number } | null;
}

/** Editor for a top-level mixer definition, which channel outputs of type "mixer" route audio into by name. */
export function MixerEditor({ mixer, onChange, onRemove, onDuplicate, pathPrefix, jumpTarget }: MixerEditorProps) {
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
      <div className="grid grid-cols-3 gap-2">
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
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
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
          />
        ))}
      </div>
    </Collapsible>
  );
}
