// Black-box parity check between the TypeScript API (backend/api) and the
// Rust panel (crates/panel): starts both in mock systemd mode on separate
// copies of the same instances directory, sends each the same requests, and
// compares status codes, ETags and JSON bodies, then the files each one left
// on disk.
//
//   npm run build:deps && npm run build -w backend/api && cargo build -p rtl-airband-panel
//   node scripts/api-parity.mjs
//
// Intentional differences are normalized away (see `normalize`): mock unit
// timestamps, absolute instance paths, poll timestamps, and fields only the
// Rust panel returns (`plan`, `unknown_settings`, `frequencies`).
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(path.join(tmpdir(), "api-parity-"));

function seed(dir) {
  cpSync(path.join(root, "fixtures/151719.conf"), path.join(dir, "alpha.conf"));
  cpSync(path.join(root, "fixtures/fork-features.conf"), path.join(dir, "beta.conf"));
}

function start(name, cmd, args, port) {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HOME: work } });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  return { name, child, port, log: () => log };
}

async function waitUp(server) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${server.port}/api/health`);
      if (r.status === 200 || r.status === 503) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${server.name} did not start:\n${server.log()}`);
}

const dirs = { ts: path.join(work, "ts"), rs: path.join(work, "rs") };
for (const d of Object.values(dirs)) {
  cpSync(path.join(root, "fixtures"), d, { recursive: true, filter: () => false });
  seed(d);
}
const common = (dir) => ["--instances-dir", dir, "--systemd-mode", "mock", "--stats-db-path", path.join(dir, "..", path.basename(dir) + ".db"), "--frontend-dist", path.join(work, "no-frontend"), "--stats-poll-interval-ms", "600000"];
const ts = start("ts", "node", [path.join(root, "backend/api/dist/index.js"), ...common(dirs.ts), "--port", "3911"], 3911);
const rs = start("rs", path.join(root, "target/debug/rtl-airband-panel"), [...common(dirs.rs), "--port", "3912"], 3912);

function normalize(value, dir) {
  if (Array.isArray(value)) return value.map((v) => normalize(v, dir));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "activeEnterTimestamp" || k === "plan" || k === "unknown_settings" || k === "frequencies") continue;
      if (/Ms$/.test(k) && typeof v === "number") {
        out[k] = "<ms>";
        continue;
      }
      out[k] = normalize(v, dir);
    }
    return out;
  }
  if (typeof value === "string") return value.split(dir).join("<dir>");
  if (typeof value === "number") return Number(value);
  return value;
}

const failures = [];
let checked = 0;

/** `mode`: "full" compares bodies, "status" compares only status codes (error-message wording may differ). */
async function check(label, method, url, { body, headers = {}, mode = "full" } = {}) {
  const send = async (server) => {
    const res = await fetch(`http://127.0.0.1:${server.port}${url}`, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }
    return { status: res.status, etag: res.headers.get("etag"), json };
  };
  const [a, b] = [await send(ts), await send(rs)];
  checked++;
  const diffs = [];
  if (a.status !== b.status) diffs.push(`status ts=${a.status} rs=${b.status}`);
  if (a.etag !== b.etag) diffs.push(`etag ts=${a.etag} rs=${b.etag}`);
  if (mode === "full") {
    const [na, nb] = [JSON.stringify(sortKeys(normalize(a.json, dirs.ts))), JSON.stringify(sortKeys(normalize(b.json, dirs.rs)))];
    if (na !== nb) diffs.push(`body\n    ts: ${na.slice(0, 1500)}\n    rs: ${nb.slice(0, 1500)}`);
  }
  if (diffs.length) failures.push(`${label} (${method} ${url}): ${diffs.join("; ")}`);
  return a.json;
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

function compareDirs() {
  const list = (d, rel = "") =>
    readdirSync(path.join(d, rel)).flatMap((f) => {
      const p = path.join(rel, f);
      if (f.startsWith(".running")) return []; // Rust-only live-apply baselines
      return statSync(path.join(d, p)).isDirectory() ? list(d, p) : [p];
    });
  const strip = (p) => p.replace(/\/[^/]*\.conf$/, (m) => (m.includes(".backups") ? m : m)).replace(/(\.backups\/[^/]+)\/.*$/, "$1/<backup>");
  const filesA = list(dirs.ts).map(strip).sort();
  const filesB = list(dirs.rs).map(strip).sort();
  if (JSON.stringify(filesA) !== JSON.stringify(filesB)) failures.push(`directory listing differs\n    ts: ${filesA}\n    rs: ${filesB}`);
  for (const f of list(dirs.ts).filter((f) => !f.includes(".backups"))) {
    let b;
    try {
      b = readFileSync(path.join(dirs.rs, f), "utf8");
    } catch {
      continue;
    }
    const a = readFileSync(path.join(dirs.ts, f), "utf8");
    if (a !== b) failures.push(`file ${f} differs\n--- ts\n${a.slice(0, 800)}\n--- rs\n${b.slice(0, 800)}`);
    checked++;
  }
}

try {
  await Promise.all([waitUp(ts), waitUp(rs)]);

  await check("health", "GET", "/api/health");
  await check("list", "GET", "/api/instances");
  const alpha = await check("get alpha", "GET", "/api/instances/alpha");
  const beta = await check("get beta (redacted secrets)", "GET", "/api/instances/beta");
  await check("missing instance", "GET", "/api/instances/nope");
  await check("invalid name", "GET", "/api/instances/bad.name");
  await check("secrets", "GET", "/api/instances/beta/secrets");
  await check("export", "GET", "/api/instances/export");
  await check("all health", "GET", "/api/instances/health");
  await check("one health", "GET", "/api/instances/alpha/health");

  await check("validate ok", "POST", "/api/instances/beta/validate", { body: beta });
  await check("validate errors", "POST", "/api/instances/alpha/validate", { body: { ...alpha, fft_size: 1000 } });
  await check("validate bad shape", "POST", "/api/instances/alpha/validate", { body: [1], mode: "status" });

  const etag = (await fetch("http://127.0.0.1:3911/api/instances/alpha")).headers.get("etag");
  const edited = structuredClone(alpha);
  edited.devices[0].gain = 33;
  await check("save without restart", "PUT", "/api/instances/alpha?restart=false", { body: edited, headers: { "if-match": etag } });
  await check("stale if-match", "PUT", "/api/instances/alpha", { body: edited, headers: { "if-match": etag } });
  await check("save invalid", "PUT", "/api/instances/alpha", { body: { ...edited, fft_size: 3 } });
  await check("save bad shape", "PUT", "/api/instances/alpha", { body: "[]", mode: "status" });
  await check("list shows pending", "GET", "/api/instances");

  // Secrets restore: send beta back with sentinels untouched plus a reordered output list.
  const betaEdit = structuredClone(beta);
  betaEdit.devices[0].channels[0].outputs.forEach((o, i) => (o._matchIndex = i));
  betaEdit.devices[0].channels[0].outputs.reverse();
  await check("save beta with sentinels", "PUT", "/api/instances/beta?restart=true", { body: betaEdit });
  await check("secrets survived", "GET", "/api/instances/beta/secrets");

  await check("apply live, socket missing", "POST", "/api/instances/beta/apply-live", { body: beta });
  await check("apply live, no socket configured", "POST", "/api/instances/alpha/apply-live", { body: edited });

  await check("options", "PATCH", "/api/instances/beta/options", { body: { jsonLogging: true, serviceUser: "rtl" } });
  await check("options bad", "PATCH", "/api/instances/beta/options", { body: { jsonLogging: "yes" }, mode: "status" });
  await check("options clear", "PATCH", "/api/instances/beta/options", { body: { serviceUser: "" } });
  await check("restart", "POST", "/api/instances/alpha/restart");
  await check("save pending again", "PUT", "/api/instances/alpha?restart=false", { body: edited });
  await check("restart pending", "POST", "/api/instances/restart-pending");
  await check("rename", "POST", "/api/instances/beta/rename", { body: { newName: "gamma" } });
  await check("rename to existing", "POST", "/api/instances/alpha/rename", { body: { newName: "gamma" } });
  await check("rename bad body", "POST", "/api/instances/alpha/rename", { body: {}, mode: "status" });

  const exported = await check("export again", "GET", "/api/instances/export");
  await check("create", "POST", "/api/instances", { body: { name: "delta", config: exported.instances.alpha } });
  await check("create duplicate", "POST", "/api/instances", { body: { name: "delta", config: exported.instances.alpha } });
  await check("create invalid name", "POST", "/api/instances", { body: { name: "health", config: exported.instances.alpha } });
  await check("create invalid config", "POST", "/api/instances", { body: { name: "zeta", config: { ...exported.instances.alpha, fft_size: 7 } } });
  await check("import", "POST", "/api/instances/import", { body: { instances: { alpha: exported.instances.alpha, epsilon: exported.instances.gamma } } });

  await check("logs", "GET", "/api/instances/alpha/logs?lines=5");
  await check("stats summary", "GET", "/api/instances/stats-summary");
  await check("stats latest", "GET", "/api/instances/alpha/stats/latest");
  await check("stats poll status", "GET", "/api/instances/alpha/stats/poll-status");
  await check("stats history", "GET", "/api/instances/alpha/stats/history?metric=x&labels=%7B%7D");
  await check("stats history no metric", "GET", "/api/instances/alpha/stats/history", { mode: "status" });
  await check("stats history bad labels", "GET", "/api/instances/alpha/stats/history?metric=x&labels=nope", { mode: "status" });
  await check("metrics", "GET", "/metrics");
  await check("delete", "DELETE", "/api/instances/delta");
  await check("delete missing", "DELETE", "/api/instances/delta");
  await check("unknown api route", "GET", "/api/nope", { mode: "status" });
  await check("final list", "GET", "/api/instances");

  compareDirs();
} finally {
  ts.child.kill();
  rs.child.kill();
}

if (failures.length) {
  console.log(`${failures.length} difference(s) across ${checked} checks:\n`);
  for (const f of failures) console.log(`- ${f}\n`);
  process.exitCode = 1;
} else {
  console.log(`API parity: ${checked} checks, no differences`);
}
rmSync(work, { recursive: true, force: true });
