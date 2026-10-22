import { useEffect, useState } from "react";
import type { RtlAirbandConfig, ValidationResult } from "../types/config.js";

type Validator = { validate: (configJson: string) => string };

let loading: Promise<Validator | null> | null = null;

/**
 * The server's own validator (crates/airband-validate) compiled to
 * WebAssembly, loaded once on first use. Resolves to null where it can't
 * load (e.g. a Content-Security-Policy without 'wasm-unsafe-eval'), in which
 * case live validation is simply off and the server still validates on save.
 */
export function loadValidator(): Promise<Validator | null> {
  loading ??= import("../generated/wasm/airband_wasm.js")
    .then(async (mod) => {
      await mod.default();
      return { validate: mod.validate };
    })
    .catch(() => null);
  return loading;
}

/** Validates `config` in the browser as the user edits (debounced); null while inactive or unavailable. */
export function useLiveValidation(config: RtlAirbandConfig | null, active: boolean): ValidationResult | null {
  const [result, setResult] = useState<ValidationResult | null>(null);
  useEffect(() => {
    if (!config || !active) {
      setResult(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void loadValidator().then((validator) => {
        if (cancelled || !validator) return;
        try {
          setResult(JSON.parse(validator.validate(JSON.stringify(config))) as ValidationResult);
        } catch {
          setResult(null);
        }
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [config, active]);
  return result;
}
