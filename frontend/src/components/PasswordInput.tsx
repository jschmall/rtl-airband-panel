import { useState } from "react";
import { inputClass } from "./styles.js";
import { REDACTED_SECRET_PLACEHOLDER } from "../lib/secrets.js";

interface PasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * Called only when `value` is still the server's redaction placeholder and
   * the user clicks "Show" -- should resolve to the real secret. Omit for a
   * field that can never hold the placeholder (e.g. a brand-new instance
   * that's never been saved), which makes Show/Hide a plain, no-fetch toggle.
   */
  onReveal?: () => Promise<string>;
}

/** A password-style input with a show/hide toggle, so a typo isn't just discovered when the Icecast/rdio-scanner connection fails. */
export function PasswordInput({ value, onChange, onReveal }: PasswordInputProps) {
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const isPlaceholder = value === REDACTED_SECRET_PLACEHOLDER;

  async function handleToggle() {
    if (!revealed && isPlaceholder && onReveal) {
      setLoading(true);
      setFailed(false);
      try {
        const real = await onReveal();
        onChange(real);
        setRevealed(true);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
      return;
    }
    setRevealed((r) => !r);
  }

  return (
    <div className="relative">
      <input
        type={revealed ? "text" : "password"}
        className={`${inputClass} w-full pr-14`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={() => void handleToggle()}
        disabled={loading}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 px-2 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50"
      >
        {loading ? "Loading…" : revealed ? "Hide" : "Show"}
      </button>
      {failed && <p className="mt-1 text-xs text-red-400">Couldn't load the real value -- try again.</p>}
    </div>
  );
}
