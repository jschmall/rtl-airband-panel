import type { InputHTMLAttributes } from "react";
import { useState } from "react";

type DraftInputProps<T> = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: T;
  parse: (text: string) => T;
  format: (value: T) => string;
  onChange: (value: T) => void;
};

/**
 * A text input for a parsed value (a number, a comma-separated list, ...)
 * that keeps the text as typed while it still means the current value.
 * Parsing and re-formatting on every keystroke would otherwise eat half-typed
 * text: `Number("37.")` is 37, so the "." of "37.2" vanished, and a list's
 * trailing "," vanished before the next entry could be typed. A value that
 * changes from outside (another field, a reset) replaces the draft, and
 * leaving the field shows the canonical text.
 */
export function DraftInput<T>({ value, parse, format, onChange, onBlur, ...rest }: DraftInputProps<T>) {
  const [draft, setDraft] = useState<string | null>(null);
  const formatted = format(value);
  const text = draft !== null && format(parse(draft)) === formatted ? draft : formatted;
  return (
    <input
      {...rest}
      value={text}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(parse(e.target.value));
      }}
      onBlur={(e) => {
        setDraft(null);
        onBlur?.(e);
      }}
    />
  );
}
