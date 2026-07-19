import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
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
  it("returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
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
      { name: FIXTURE_INSTANCE_NAME, confPath: expect.stringContaining(FIXTURE_INSTANCE_NAME), unit: `${FIXTURE_INSTANCE_NAME}.service` },
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
});

describe("GET /instances/:name/health", () => {
  it("returns the unit's status", async () => {
    await seedFixture(h.instancesDir);
    const res = await app.inject({ method: "GET", url: `/api/instances/${FIXTURE_INSTANCE_NAME}/health` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ unit: `${FIXTURE_INSTANCE_NAME}.service` });
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
