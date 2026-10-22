// Records the TypeScript parser's behavior (backend/parser) over a corpus of
// .conf files as golden JSON, which crates/airband-config's parity test must
// reproduce exactly. Run after `npm run build -w backend/parser`:
//
//   node scripts/gen-parity-goldens.mjs
//
// Inputs: fixtures/*.conf and crates/airband-config/tests/corpus/*.conf.
// Output: crates/airband-config/tests/golden/<name>.json, one per input, with
// either { ok: true, domain, serialized, ast_serialized } or { ok: false, error }.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseConfig, serializeConfig, parseConfigFile, serializeConfigFile } from "../backend/parser/dist/index.js";

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
