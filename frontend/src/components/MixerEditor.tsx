import type { Mixer, Output } from "@rtl-airband-panel/parser";
import { BoolField, Field } from "./Field.js";
import { OutputEditor } from "./OutputEditor.js";
import { addButtonClass, inputClass, removeButtonClass } from "./styles.js";
import { appendItem, removeAt, updateAt } from "../lib/array-utils.js";
import { defaultIcecastOutput } from "../lib/defaults.js";
import { numberOrUndefined } from "../lib/number-utils.js";

interface MixerEditorProps {
  mixer: Mixer;
  onChange: (mixer: Mixer) => void;
  onRemove: () => void;
}

/** Editor for a top-level mixer definition, which channel outputs of type "mixer" route audio into by name. */
export function MixerEditor({ mixer, onChange, onRemove }: MixerEditorProps) {
  return (
    <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-900 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-100">Mixer — {mixer.name || "(unnamed)"}</h3>
        <button type="button" onClick={onRemove} className={removeButtonClass}>
          Remove mixer
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Field label="Name (referenced by channel outputs of type 'mixer')">
          <input className={inputClass} value={mixer.name} onChange={(e) => onChange({ ...mixer, name: e.target.value })} />
        </Field>
        <Field label="Highpass Hz (optional; 0 disables)">
          <input
            type="number"
            className={inputClass}
            value={mixer.highpass ?? ""}
            onChange={(e) => onChange({ ...mixer, highpass: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Lowpass Hz (optional; 0 disables)">
          <input
            type="number"
            className={inputClass}
            value={mixer.lowpass ?? ""}
            onChange={(e) => onChange({ ...mixer, lowpass: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <BoolField label="Disable" checked={mixer.disable} onChange={(v) => onChange({ ...mixer, disable: v })} />
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
            key={i}
            output={output}
            excludeMixerType
            onChange={(next) => onChange({ ...mixer, outputs: updateAt(mixer.outputs, i, next as Exclude<Output, { type: "mixer" }>) })}
            onRemove={() => onChange({ ...mixer, outputs: removeAt(mixer.outputs, i) })}
          />
        ))}
      </div>
    </div>
  );
}
