import { useState } from "react";
import { inputClass } from "./styles.js";

interface PasswordInputProps {
  value: string;
  onChange: (value: string) => void;
}

/** A password-style input with a show/hide toggle, so a typo isn't just discovered when the Icecast/rdio-scanner connection fails. */
export function PasswordInput({ value, onChange }: PasswordInputProps) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="relative">
      <input
        type={revealed ? "text" : "password"}
        className={`${inputClass} w-full pr-12`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 px-2 text-xs text-slate-400 hover:text-slate-200"
      >
        {revealed ? "Hide" : "Show"}
      </button>
    </div>
  );
}
