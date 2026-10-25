import type { ReactNode } from "react";
import { useForkFeature } from "../state/AirbandBuildContext.js";
import { checkboxClass } from "./styles.js";
import { Tooltip } from "./Tooltip.js";

const NEEDS_FORK_TITLE = "This instance's rtl_airband isn't the jschmall fork (or lacks this feature), so it ignores this setting.";

/** Marks a field whose fork feature the instance's rtl_airband lacks. */
export function NeedsFork() {
  return (
    <span className="ml-1.5 text-[11px] font-medium text-amber-300" title={NEEDS_FORK_TITLE}>
      · needs the fork
    </span>
  );
}

/**
 * A labelled input. `requires` names the fork feature the setting needs: when
 * the instance's rtl_airband lacks it, the field says so and is disabled
 * unless it already has a value (`hasValue`), which stays editable so it can
 * be cleared.
 */
export function Field({
  label,
  tooltip,
  requires,
  hasValue = false,
  children,
}: {
  label: string;
  tooltip?: string;
  requires?: string;
  hasValue?: boolean;
  children: ReactNode;
}) {
  const locked = !useForkFeature(requires);
  const field = (
    <label className="flex flex-col gap-1">
      <span>
        {tooltip ? (
          <Tooltip content={tooltip} className="cursor-help text-xs text-slate-300 underline decoration-dotted decoration-slate-600 underline-offset-2">
            {label}
          </Tooltip>
        ) : (
          <span className="text-xs text-slate-300">{label}</span>
        )}
        {locked && <NeedsFork />}
      </span>
      {children}
    </label>
  );
  return locked ? (
    <fieldset disabled={!hasValue} className="contents">
      {field}
    </fieldset>
  ) : (
    field
  );
}

/**
 * A checkbox. With `requires` (a fork feature the instance's rtl_airband
 * lacks) it's disabled while it holds `defaultValue`, the value the setting
 * has when unset, so a non-default value can still be switched back.
 */
export function BoolField({
  label,
  tooltip,
  checked,
  onChange,
  requires,
  defaultValue = false,
}: {
  label: string;
  tooltip?: string;
  checked?: boolean;
  onChange: (v: boolean) => void;
  requires?: string;
  defaultValue?: boolean;
}) {
  const locked = !useForkFeature(requires);
  const value = checked ?? defaultValue;
  return (
    <label className="flex items-center gap-2 text-sm text-slate-300">
      <input
        type="checkbox"
        className={checkboxClass}
        checked={checked ?? false}
        disabled={locked && value === defaultValue}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {tooltip ? (
          <Tooltip content={tooltip} className="cursor-help underline decoration-dotted decoration-slate-600 underline-offset-2">
            {label}
          </Tooltip>
        ) : (
          <span>{label}</span>
        )}
        {locked && <NeedsFork />}
      </span>
    </label>
  );
}
