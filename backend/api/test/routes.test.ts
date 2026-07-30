import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { CommandError } from "../src/systemd/run-command.js";
import { buildHarness, FIXTURE_INSTANCE_NAME, seedFixture, teardownHarness, type TestHarness } from "./helpers.js";

let h: TestHarness;
let app: FastifyInstance;

beforeEach(async () => {
  h = await buildHarness();
  app = buildApp(h.service, h.statsService, { logger: false });
});

afterEach(async () => {
  await app.close();
  await teardownHarness(h);
});

describe("GET /health", () => {
  it("returns ok with passing readiness checks when the instances dir and stats DB are both fine", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", checks: { instancesDir: "ok", statsDb: "ok" } });
  });

  it("returns 503 with the failing check surfaced if the stats DB is unusable", async () => {
    h.statsStore.close();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe("degraded");
    expect(body.checks.instancesDir).toBe("ok");
    expect(body.checks.statsDb).not.toBe("ok");
  });
});

describe("GET /metrics", () => {
  it("is served at the root, not under /api, and returns Prometheus text format", async () => {
    await seedFixture(h.instancesDir);
    h.statsStore.insertBatch(FIXTURE_INSTANCE_NAME, [{ metric: "channel_signal_level", labels: { freq: "151.160" }, value: 3.5 }], Date.now());

    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toContain(`channel_signal_level{freq="151.160",instance="${FIXTURE_INSTANCE_NAME}"} 3.5`);
  });

  it("returns an empty body when nothing has been polled yet", async () => {
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("");
  });
});

describe("GET /instances", () => {
  it("returns an empty list when no instances exist", async () => {
    const res = await app.inject({ method: "GET", url: "/api/instances" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("lists a seeded instance", async () => {
    await seedFixture(h.instancesDir);
    const res = await app.inject({ method: "GET", url: "/api/instances" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        name: FIXTURE_INSTANCE_NAME,
        confPath: expect.stringContaining(FIXTURE_INSTANCE_NAME),
        unit: `${FIXTURE_INSTANCE_NAME}.service`,
        pendingRestart: false,
        jsonLogging: false,
        searchFields: expect.any(Array),
      },
    ]);
  });
});

describe("GET /instances/:name", () => {
  it("404s for a nonexistent instance", async () => {
    const res = await app.inject({ method: "GET", url: "/api/instances/nope" });
    expect(res.statusCode).toBe(404);
  });

  it("400s for a name that fails the safe-slug check", async () => {
    const res = await app.inject({ method: "GET", url: "/api/instances/..%2F..%2Fetc%2Fpasswd" });
    expect(res.statusCode).toBe(400);
  });

  it("returns the parsed config for a seeded instance", async () => {
    await seedFixture(h.instancesDir);
    const res = await app.inject({ method: "GET", url: `/api/instances/${FIXTURE_INSTANCE_NAME}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.devices).toHaveLength(1);
    expect(body.devices[0].channels).toHaveLength(22);
  });

  it("redacts an icecast output's password instead of returning it in plaintext", async () => {
    const config = {
      multiple_demod_threads: true,
      multiple_output_threads: true,
      stats_filepath: "/tmp/stats.txt",
      localtime: true,
      devices: [
        {
          type: "rtlsdr",
          serial: "1",
          gain: 29,
          centerfreq: 100_000_000,
          sample_rate: 1_400_000,
          correction: 0,
          channels: [
            {
              freq: 100_000_000,
              afc: 0,
              modulation: "nfm",
              outputs: [{ type: "icecast", server: "s", port: 8000, mountpoint: "/m", username: "source", password: "hunter2" }],
            },
          ],
        },
      ],
    };
    await app.inject({ method: "POST", url: "/api/instances", payload: { name: "rtl_icecast", config } });

    const res = await app.inject({ method: "GET", url: "/api/instances/rtl_icecast" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.devices[0].channels[0].outputs[0].password).not.toBe("hunter2");
  });

  it("sets an ETag header identifying the current config version", async () => {
    await seedFixture(h.instancesDir);
    const res = await app.inject({ method: "GET", url: `/api/instances/${FIXTURE_INSTANCE_NAME}` });
    expect(res.headers["etag"]).toBeDefined();
    expect(typeof res.headers["etag"]).toBe("string");
  });
});

describe("GET /instances/:name/secrets", () => {
  const config = {
    multiple_demod_threads: true,
    multiple_output_threads: true,
    stats_filepath: "/tmp/stats.txt",
    localtime: true,
    devices: [
      {
        type: "rtlsdr",
        serial: "1",
        gain: 29,
        centerfreq: 100_000_000,
        sample_rate: 1_400_000,
        correction: 0,
        channels: [
          {
            freq: 100_000_000,
            afc: 0,
            modulation: "nfm",
            outputs: [{ type: "icecast", server: "s", port: 8000, mountpoint: "/m", username: "source", password: "hunter2" }],
          },
        ],
      },
    ],
  };

  it("returns the real, unredacted secret value -- unlike GET /instances/:name", async () => {
    await app.inject({ method: "POST", url: "/api/instances", payload: { name: "rtl_icecast", config } });

    const redacted = await app.inject({ method: "GET", url: "/api/instances/rtl_icecast" });
    expect(redacted.json().devices[0].channels[0].outputs[0].password).not.toBe("hunter2");

    const revealed = await app.inject({ method: "GET", url: "/api/instances/rtl_icecast/secrets" });
    expect(revealed.statusCode).toBe(200);
    expect(revealed.json().devices[0].channels[0].outputs[0].password).toBe("hunter2");
  });

  it("404s for a nonexistent instance", async () => {
    const res = await app.inject({ method: "GET", url: "/api/instances/nope/secrets" });
    expect(res.statusCode).toBe(404);
  });
});

describe("PUT /instances/:name optimistic concurrency (If-Match)", () => {
  it("saves normally when If-Match isn't sent at all", async () => {
    await seedFixture(h.instancesDir);
    const config = await h.service.getConfig(FIXTURE_INSTANCE_NAME);
    const res = await app.inject({ method: "PUT", url: `/api/instances/${FIXTURE_INSTANCE_NAME}`, payload: config });
    expect(res.statusCode).toBe(200);
  });

  it("saves when If-Match matches the current ETag", async () => {
    await seedFixture(h.instancesDir);
    const getRes = await app.inject({ method: "GET", url: `/api/instances/${FIXTURE_INSTANCE_NAME}` });
    const config = getRes.json();

    const res = await app.inject({
      method: "PUT",
      url: `/api/instances/${FIXTURE_INSTANCE_NAME}`,
      headers: { "if-match": getRes.headers["etag"] as string },
      payload: config,
    });
    expect(res.statusCode).toBe(200);
  });

  it("409s when If-Match is stale — the config changed on disk since it was fetched", async () => {
    await seedFixture(h.instancesDir);
    const getRes = await app.inject({ method: "GET", url: `/api/instances/${FIXTURE_INSTANCE_NAME}` });
    const staleEtag = getRes.headers["etag"] as string;
    const config = getRes.json();

    // Someone else (or another tab) saves first, moving the on-disk version on.
    await app.inject({ method: "PUT", url: `/api/instances/${FIXTURE_INSTANCE_NAME}`, payload: config });

    const res = await app.inject({
      method: "PUT",
      url: `/api/instances/${FIXTURE_INSTANCE_NAME}`,
      headers: { "if-match": staleEtag },
      payload: { ...config, tau: 250 },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe("security middleware", () => {
  it("sets basic security headers on every response", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });

  it("sets rate-limit headers on every response", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.headers["x-ratelimit-limit"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
  });

  it("sets a per-request x-request-id header, correlating a response to its server-side (audit) log lines", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(typeof res.headers["x-request-id"]).toBe("string");
    expect(res.headers["x-request-id"]).not.toBe("");
  });
});

describe("PUT /instances/:name", () => {
  it("400s on a structurally invalid body", async () => {
    await seedFixture(h.instancesDir);
    const res = await app.inject({
      method: "PUT",
      url: `/api/instances/${FIXTURE_INSTANCE_NAME}`,
      payload: { not: "a valid config" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("422s on a semantically invalid config and does not restart", async () => {
    await seedFixture(h.instancesDir);
    const before = await h.service.getConfig(FIXTURE_INSTANCE_NAME);
    const outputs = before.devices[0]!.channels[0]!.outputs;
    const collision = {
      ...before,
      devices: [
        {
          ...before.devices[0]!,
          channels: [
            { freq: 151_300_000, afc: 0, modulation: "nfm", outputs },
            { freq: 151_300_100, afc: 0, modulation: "nfm", outputs },
          ],
        },
      ],
    };

    const res = await app.inject({ method: "PUT", url: `/api/instances/${FIXTURE_INSTANCE_NAME}`, payload: collision });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors.length).toBeGreaterThan(0);
    expect(h.systemd.calls).toEqual([]);
  });

  it("200s and restarts only this unit on a valid config", async () => {
    await seedFixture(h.instancesDir);
    const config = await h.service.getConfig(FIXTURE_INSTANCE_NAME);

    const res = await app.inject({ method: "PUT", url: `/api/instances/${FIXTURE_INSTANCE_NAME}`, payload: config });
    expect(res.statusCode).toBe(200);
    expect(h.systemd.calls).toEqual([`restart ${FIXTURE_INSTANCE_NAME}.service`, `status ${FIXTURE_INSTANCE_NAME}.service`]);
  });

  it("200s and does not restart when ?restart=false", async () => {
    await seedFixture(h.instancesDir);
    const config = await h.service.getConfig(FIXTURE_INSTANCE_NAME);

    const res = await app.inject({ method: "PUT", url: `/api/instances/${FIXTURE_INSTANCE_NAME}?restart=false`, payload: config });
    expect(res.statusCode).toBe(200);
    expect(h.systemd.calls).toEqual([`status ${FIXTURE_INSTANCE_NAME}.service`]);
  });
});

describe("POST /instances (create)", () => {
  const minimalConfig = {
    multiple_demod_threads: true,
    multiple_output_threads: true,
    stats_filepath: "/tmp/stats.txt",
    localtime: true,
    devices: [
      {
        type: "rtlsdr",
        serial: "1",
        gain: 29,
        centerfreq: 100_000_000,
        sample_rate: 1_400_000,
        correction: 0,
        channels: [
          {
            freq: 100_000_000,
            afc: 0,
            modulation: "nfm",
            outputs: [{ type: "pulse", server: "10.0.0.1", sink: "s", stream_name: "s", continuous: false }],
          },
        ],
      },
    ],
  };

  it("creates a new instance and installs a unit", async () => {
    const res = await app.inject({ method: "POST", url: "/api/instances", payload: { name: "rtl_100000", config: minimalConfig } });
    expect(res.statusCode).toBe(200);
    expect(h.systemd.calls).toContain("install-unit rtl_100000.service");
  });

  it("409s when the instance already exists", async () => {
    await seedFixture(h.instancesDir);
    const res = await app.inject({
      method: "POST",
      url: "/api/instances",
      payload: { name: FIXTURE_INSTANCE_NAME, config: minimalConfig },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe("GET /instances/export and POST /instances/import", () => {
  const minimalConfig = {
    multiple_demod_threads: true,
    multiple_output_threads: true,
    stats_filepath: "/tmp/stats.txt",
    localtime: true,
    devices: [
      {
        type: "rtlsdr",
        serial: "1",
        gain: 29,
        centerfreq: 100_000_000,
        sample_rate: 1_400_000,
        correction: 0,
        channels: [{ freq: 100_000_000, afc: 0, modulation: "nfm", outputs: [{ type: "pulse", server: "10.0.0.1", sink: "s", stream_name: "s", continuous: false }] }],
      },
    ],
  };

  it("exports every instance as a bundle", async () => {
    await app.inject({ method: "POST", url: "/api/instances", payload: { name: "rtl_100000", config: minimalConfig } });

    const res = await app.inject({ method: "GET", url: "/api/instances/export" });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().instances)).toEqual(["rtl_100000"]);
  });

  it("imports a bundle, creating instances that don't already exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/instances/import",
      payload: { instances: { rtl_imported: minimalConfig } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ rtl_imported: { status: "created" } });
    expect(h.systemd.calls).toContain("install-unit rtl_imported.service");
  });

  it("skips an instance whose name already exists instead of overwriting it", async () => {
    await seedFixture(h.instancesDir);
    const res = await app.inject({
      method: "POST",
      url: "/api/instances/import",
      payload: { instances: { [FIXTURE_INSTANCE_NAME]: minimalConfig } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ [FIXTURE_INSTANCE_NAME]: { status: "skipped" } });
  });

  it("round-trips export -> import", async () => {
    await app.inject({ method: "POST", url: "/api/instances", payload: { name: "rtl_100000", config: minimalConfig } });
    const exportRes = await app.inject({ method: "GET", url: "/api/instances/export" });

    await app.inject({ method: "DELETE", url: "/api/instances/rtl_100000" });

    const importRes = await app.inject({ method: "POST", url: "/api/instances/import", payload: exportRes.json() });
    expect(importRes.json()).toEqual({ rtl_100000: { status: "created" } });
  });
});

describe("DELETE /instances/:name", () => {
  it("removes an existing instance", async () => {
    await seedFixture(h.instancesDir);
    const res = await app.inject({ method: "DELETE", url: `/api/instances/${FIXTURE_INSTANCE_NAME}` });
    expect(res.statusCode).toBe(204);
    expect(await h.service.listInstances()).toEqual([]);
  });

  it("404s for a nonexistent instance", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/instances/nope" });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /instances/:name/restart", () => {
  it("restarts only the named unit", async () => {
    await seedFixture(h.instancesDir);
    const res = await app.inject({ method: "POST", url: `/api/instances/${FIXTURE_INSTANCE_NAME}/restart` });
    expect(res.statusCode).toBe(200);
    expect(h.systemd.calls).toEqual([`restart ${FIXTURE_INSTANCE_NAME}.service`, `status ${FIXTURE_INSTANCE_NAME}.service`]);
  });

  it("maps a failed systemctl invocation to a 502 with exit code and stderr, not a generic 500", async () => {
    await seedFixture(h.instancesDir);
    h.systemd.restart = async () => {
      throw new CommandError("systemctl", ["restart", `${FIXTURE_INSTANCE_NAME}.service`], 1, "Unit not found.");
    };

    const res = await app.inject({ method: "POST", url: `/api/instances/${FIXTURE_INSTANCE_NAME}/restart` });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ exitCode: 1, stderr: "Unit not found." });
  });
});

describe("PATCH /instances/:name/options", () => {
  it("sets jsonLogging, reinstalls the unit with -j, and restarts by default", async () => {
    await seedFixture(h.instancesDir);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/instances/${FIXTURE_INSTANCE_NAME}/options`,
      payload: { jsonLogging: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ options: { jsonLogging: true } });
    expect(h.systemd.unitFiles.get(`${FIXTURE_INSTANCE_NAME}.service`)).toContain("ExecStart=/usr/local/bin/rtl_airband -F -e -j -c");
    expect(h.systemd.calls).toContain(`restart ${FIXTURE_INSTANCE_NAME}.service`);
  });

  it("rejects a non-boolean jsonLogging value", async () => {
    await seedFixture(h.instancesDir);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/instances/${FIXTURE_INSTANCE_NAME}/options`,
      payload: { jsonLogging: "yes" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404s for a nonexistent instance", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/instances/does_not_exist/options", payload: { jsonLogging: true } });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /instances/restart-pending", () => {
  it("restarts every pending instance and reports per-instance results", async () => {
    await seedFixture(h.instancesDir);
    await seedFixture(h.instancesDir, "rtl_other");
    await h.service.updateConfig(FIXTURE_INSTANCE_NAME, await h.service.getConfig(FIXTURE_INSTANCE_NAME), { restart: false });
    await h.service.updateConfig("rtl_other", await h.service.getConfig("rtl_other"), { restart: false });

    const res = await app.inject({ method: "POST", url: "/api/instances/restart-pending" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      [FIXTURE_INSTANCE_NAME]: { status: { activeState: "active" } },
      rtl_other: { status: { activeState: "active" } },
    });
  });

  it("returns an empty object when nothing is pending", async () => {
    await seedFixture(h.instancesDir);
    const res = await app.inject({ method: "POST", url: "/api/instances/restart-pending" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
  });
});

describe("POST /instances/:name/rename", () => {
  it("renames the instance and stands up the new unit", async () => {
    await seedFixture(h.instancesDir);
    const res = await app.inject({
      method: "POST",
      url: `/api/instances/${FIXTURE_INSTANCE_NAME}/rename`,
      payload: { newName: "rtl_renamed" },
    });
    expect(res.statusCode).toBe(200);
    expect(h.systemd.calls).toContain("start rtl_renamed.service");
    expect(await h.service.listInstances()).toEqual([
      { name: "rtl_renamed", confPath: expect.stringContaining("rtl_renamed"), unit: "rtl_renamed.service", pendingRestart: false, jsonLogging: false, searchFields: expect.any(Array) },
    ]);
  });

  it("400s on a structurally invalid body", async () => {
    await seedFixture(h.instancesDir);
    const res = await app.inject({
      method: "POST",
      url: `/api/instances/${FIXTURE_INSTANCE_NAME}/rename`,
      payload: { notNewName: "rtl_renamed" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404s for a nonexistent instance", async () => {
    const res = await app.inject({ method: "POST", url: "/api/instances/nope/rename", payload: { newName: "rtl_renamed" } });
    expect(res.statusCode).toBe(404);
  });

  it("409s when the new name is already taken", async () => {
    await seedFixture(h.instancesDir);
    await seedFixture(h.instancesDir, "rtl_other");
    const res = await app.inject({
      method: "POST",
      url: `/api/instances/${FIXTURE_INSTANCE_NAME}/rename`,
      payload: { newName: "rtl_other" },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe("GET /instances/:name/health", () => {
  it("returns the unit's status", async () => {
    await seedFixture(h.instancesDir);
    const res = await app.inject({ method: "GET", url: `/api/instances/${FIXTURE_INSTANCE_NAME}/health` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ unit: `${FIXTURE_INSTANCE_NAME}.service` });
  });
});

describe("GET /instances/:name/logs", () => {
  it("returns the unit's recent journal lines", async () => {
    await seedFixture(h.instancesDir);
    h.systemd.logLines.set(`${FIXTURE_INSTANCE_NAME}.service`, [
      { timestamp: "2026-07-29T14:00:00+0000", message: "rtl_airband[1]: Started" },
      { timestamp: "2026-07-29T14:00:01+0000", message: "rtl_airband[1]: All channels loaded" },
    ]);
    const res = await app.inject({ method: "GET", url: `/api/instances/${FIXTURE_INSTANCE_NAME}/logs` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      lines: [
        { timestamp: "2026-07-29T14:00:00+0000", message: "rtl_airband[1]: Started" },
        { timestamp: "2026-07-29T14:00:01+0000", message: "rtl_airband[1]: All channels loaded" },
      ],
    });
  });

  it("clamps an out-of-range lines query before it reaches the systemd adapter", async () => {
    await seedFixture(h.instancesDir);
    const res = await app.inject({ method: "GET", url: `/api/instances/${FIXTURE_INSTANCE_NAME}/logs?lines=999999` });
    expect(res.statusCode).toBe(200);
    expect(h.systemd.calls).toContain(`logs ${FIXTURE_INSTANCE_NAME}.service 2000`);
  });

  it("defaults to 200 lines when none is specified", async () => {
    await seedFixture(h.instancesDir);
    const res = await app.inject({ method: "GET", url: `/api/instances/${FIXTURE_INSTANCE_NAME}/logs` });
    expect(res.statusCode).toBe(200);
    expect(h.systemd.calls).toContain(`logs ${FIXTURE_INSTANCE_NAME}.service 200`);
  });
});

describe("GET /instances/:name/logs/stream", () => {
  it("streams SSE frames for backlog and live-pushed lines, then ends when the source ends", async () => {
    await seedFixture(h.instancesDir);
    const unit = `${FIXTURE_INSTANCE_NAME}.service`;
    h.systemd.logLines.set(unit, [{ timestamp: "2026-07-29T14:00:00+0000", message: "Started" }]);

    const injected = app.inject({ method: "GET", url: `/api/instances/${FIXTURE_INSTANCE_NAME}/logs/stream` });

    const stream = await h.systemd.waitForLogStream(unit);
    stream.push({ timestamp: "2026-07-29T14:00:01+0000", message: "All channels loaded" });
    stream.end();

    const res = await injected;
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.body).toContain(`data: ${JSON.stringify({ timestamp: "2026-07-29T14:00:00+0000", message: "Started" })}\n\n`);
    expect(res.body).toContain(`data: ${JSON.stringify({ timestamp: "2026-07-29T14:00:01+0000", message: "All channels loaded" })}\n\n`);
    expect(h.systemd.calls).toContain(`follow-logs ${unit} 200`);
  });

  it("clamps an out-of-range lines query before it reaches the systemd adapter", async () => {
    await seedFixture(h.instancesDir);
    const unit = `${FIXTURE_INSTANCE_NAME}.service`;
    const injected = app.inject({ method: "GET", url: `/api/instances/${FIXTURE_INSTANCE_NAME}/logs/stream?lines=999999` });
    const stream = await h.systemd.waitForLogStream(unit);
    stream.end();
    await injected;
    expect(h.systemd.calls).toContain(`follow-logs ${unit} 2000`);
  });
});

describe("POST /instances/:name/validate", () => {
  it("returns no errors for a valid config and doesn't write or restart anything", async () => {
    await seedFixture(h.instancesDir);
    const config = await h.service.getConfig(FIXTURE_INSTANCE_NAME);

    const res = await app.inject({ method: "POST", url: `/api/instances/${FIXTURE_INSTANCE_NAME}/validate`, payload: config });
    expect(res.statusCode).toBe(200);
    expect(res.json().errors).toEqual([]);
    expect(h.systemd.calls).toEqual([]);
  });

  it("returns errors (200, not 422) for an invalid config, since nothing was actually attempted", async () => {
    await seedFixture(h.instancesDir);
    const before = await h.service.getConfig(FIXTURE_INSTANCE_NAME);
    const outputs = before.devices[0]!.channels[0]!.outputs;
    const collision = {
      ...before,
      devices: [
        {
          ...before.devices[0]!,
          channels: [
            { freq: 151_300_000, afc: 0, modulation: "nfm", outputs },
            { freq: 151_300_100, afc: 0, modulation: "nfm", outputs },
          ],
        },
      ],
    };

    const res = await app.inject({ method: "POST", url: `/api/instances/${FIXTURE_INSTANCE_NAME}/validate`, payload: collision });
    expect(res.statusCode).toBe(200);
    expect(res.json().errors.length).toBeGreaterThan(0);
  });

  it("404s for a nonexistent instance", async () => {
    const config = {
      multiple_demod_threads: true,
      multiple_output_threads: true,
      stats_filepath: "/tmp/stats.txt",
      localtime: true,
      devices: [
        {
          type: "rtlsdr",
          serial: "1",
          gain: 29,
          centerfreq: 100_000_000,
          sample_rate: 1_400_000,
          correction: 0,
          channels: [{ freq: 100_000_000, afc: 0, modulation: "nfm", outputs: [{ type: "pulse", server: "s", sink: "s", stream_name: "s", continuous: false }] }],
        },
      ],
    };
    const res = await app.inject({ method: "POST", url: "/api/instances/nope/validate", payload: config });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /instances/:name/stats/latest", () => {
  it("404s for a nonexistent instance", async () => {
    const res = await app.inject({ method: "GET", url: "/api/instances/nope/stats/latest" });
    expect(res.statusCode).toBe(404);
  });

  it("returns an empty array when nothing has been polled yet", async () => {
    await seedFixture(h.instancesDir);
    const res = await app.inject({ method: "GET", url: `/api/instances/${FIXTURE_INSTANCE_NAME}/stats/latest` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("returns the most recent sample batch", async () => {
    await seedFixture(h.instancesDir);
    h.statsStore.insertBatch(
      FIXTURE_INSTANCE_NAME,
      [{ metric: "channel_signal_level", labels: { freq: "151.160" }, value: 3.5 }],
      Date.now()
    );
    const res = await app.inject({ method: "GET", url: `/api/instances/${FIXTURE_INSTANCE_NAME}/stats/latest` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ metric: "channel_signal_level", labels: { freq: "151.160" }, value: 3.5 }]);
  });
});

describe("GET /instances/:name/stats/poll-status", () => {
  it("404s for a nonexistent instance", async () => {
    const res = await app.inject({ method: "GET", url: "/api/instances/nope/stats/poll-status" });
    expect(res.statusCode).toBe(404);
  });

  it("returns an empty status when nothing has been polled yet", async () => {
    await seedFixture(h.instancesDir);
    const res = await app.inject({ method: "GET", url: `/api/instances/${FIXTURE_INSTANCE_NAME}/stats/poll-status` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
  });
});

describe("GET /instances/:name/stats/history", () => {
  it("400s when metric is missing", async () => {
    await seedFixture(h.instancesDir);
    const res = await app.inject({ method: "GET", url: `/api/instances/${FIXTURE_INSTANCE_NAME}/stats/history` });
    expect(res.statusCode).toBe(400);
  });

  it("400s when labels is not valid JSON", async () => {
    await seedFixture(h.instancesDir);
    const res = await app.inject({
      method: "GET",
      url: `/api/instances/${FIXTURE_INSTANCE_NAME}/stats/history?metric=m&labels=not-json`,
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns matching points filtered by metric, labels, and time range", async () => {
    await seedFixture(h.instancesDir);
    h.statsStore.insertBatch(FIXTURE_INSTANCE_NAME, [{ metric: "m", labels: { freq: "1" }, value: 1 }], 1000);
    h.statsStore.insertBatch(FIXTURE_INSTANCE_NAME, [{ metric: "m", labels: { freq: "1" }, value: 2 }], 2000);
    h.statsStore.insertBatch(FIXTURE_INSTANCE_NAME, [{ metric: "m", labels: { freq: "2" }, value: 99 }], 1500);

    const labels = encodeURIComponent(JSON.stringify({ freq: "1" }));
    const res = await app.inject({
      method: "GET",
      url: `/api/instances/${FIXTURE_INSTANCE_NAME}/stats/history?metric=m&labels=${labels}&sinceMs=1500`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ ts: 2000, value: 2 }]);
  });
});
