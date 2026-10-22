// Records the TypeScript parser's (backend/parser) and validator's
// (backend/validate) behavior over corpora of .conf files as golden JSON,
// which the Rust crates' parity tests must reproduce exactly. Run after
// `npm run build:deps`:
//
//   node scripts/gen-parity-goldens.mjs
//
// Parser: fixtures/*.conf and crates/airband-config/tests/corpus/*.conf ->
// crates/airband-config/tests/golden/<name>.json, one per input, with either
// { ok: true, domain, serialized, ast_serialized } or { ok: false, error }.
//
// Validator: every input above that parses, plus
// crates/airband-validate/tests/corpus/*.conf ->
// crates/airband-validate/tests/golden/<name>.json with { errors, warnings }.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseConfig, serializeConfig, parseConfigFile, serializeConfigFile } from "../backend/parser/dist/index.js";
import { validateConfig } from "../backend/validate/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputDirs = [path.join(root, "fixtures"), path.join(root, "crates/airband-config/tests/corpus")];
const outDir = path.join(root, "crates/airband-config/tests/golden");
mkdirSync(outDir, { recursive: true });

let count = 0;
for (const dir of inputDirs) {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".conf")).sort()) {
    const source = readFileSync(path.join(dir, file), "utf8");
    let golden;
    try {
      const domain = parseConfigFile(source);
      golden = {
        ok: true,
        domain,
        serialized: serializeConfigFile(domain),
        ast_serialized: serializeConfig(parseConfig(source)),
      };
    } catch (err) {
      golden = { ok: false, error: err.message };
    }
    writeFileSync(path.join(outDir, file.replace(/\.conf$/, ".json")), JSON.stringify(golden, null, 2) + "\n");
    count++;
  }
}
console.log(`wrote ${count} goldens to ${path.relative(root, outDir)}`);

const validateInputDirs = [...inputDirs, path.join(root, "crates/airband-validate/tests/corpus")];
const validateOutDir = path.join(root, "crates/airband-validate/tests/golden");
mkdirSync(validateOutDir, { recursive: true });

let validateCount = 0;
for (const dir of validateInputDirs) {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".conf")).sort()) {
    let domain;
    try {
      domain = parseConfigFile(readFileSync(path.join(dir, file), "utf8"));
    } catch {
      continue; // parse errors are covered by the parser goldens
    }
    const outPath = path.join(validateOutDir, file.replace(/\.conf$/, ".json"));
    writeFileSync(outPath, JSON.stringify(validateConfig(domain), null, 2) + "\n");
    validateCount++;
  }
}
console.log(`wrote ${validateCount} goldens to ${path.relative(root, validateOutDir)}`);
