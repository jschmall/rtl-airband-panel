import { useEffect, useState } from "react";
import type { RtlAirbandConfig, ValidationResult } from "../types/config.js";

type Validator = { validate: (configJson: string) => string; validateFor: (configJson: string, featuresJson: string) => string };

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
      return { validate: mod.validate, validateFor: mod.validate_for };
    })
    .catch(() => null);
  return loading;
}

/**
 * Validates `config` in the browser as the user edits (debounced); null while inactive or unavailable.
 * `features` holds it to the instance's rtl_airband build like the server does (null: build unknown).
 */
export function useLiveValidation(
  config: RtlAirbandConfig | null,
  active: boolean,
  features: readonly string[] | null = null
): ValidationResult | null {
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
          setResult(JSON.parse(validator.validateFor(JSON.stringify(config), JSON.stringify(features))) as ValidationResult);
        } catch {
          setResult(null);
        }
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [config, active, features]);
  return result;
}
