import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { buildHarness, teardownHarness, type TestHarness } from "./helpers.js";

let h: TestHarness;
let distDir: string;

beforeEach(async () => {
  h = await buildHarness();
  distDir = await mkdtemp(path.join(tmpdir(), "rtl-panel-dist-"));
});

afterEach(async () => {
  await teardownHarness(h);
  await rm(distDir, { recursive: true, force: true });
});

describe("registerFrontend (via buildApp)", () => {
  it("serves API-only (default Fastify 404) when frontendDistPath has no build", async () => {
    const app = buildApp(h.service, h.statsService, { logger: false, frontendDistPath: distDir });
    const res = await app.inject({ method: "GET", url: "/instances/foo" });
    expect(res.statusCode).toBe(404);
    // not the SPA shell -- Fastify's own default not-found response
    expect(res.json()).toMatchObject({ error: "Not Found" });
    await app.close();
  });

  it("serves index.html for the root and for unmatched client-side routes (SPA fallback)", async () => {
    await writeFile(path.join(distDir, "index.html"), "<html><body>panel</body></html>", "utf8");
    const app = buildApp(h.service, h.statsService, { logger: false, frontendDistPath: distDir });

    const root = await app.inject({ method: "GET", url: "/" });
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain("panel");

    const clientRoute = await app.inject({ method: "GET", url: "/instances/rtl_151719/stats" });
    expect(clientRoute.statusCode).toBe(200);
    expect(clientRoute.body).toContain("panel");

    await app.close();
  });

  it("serves a real static asset instead of falling back to index.html", async () => {
    await writeFile(path.join(distDir, "index.html"), "<html></html>", "utf8");
    await mkdir(path.join(distDir, "assets"), { recursive: true });
    await writeFile(path.join(distDir, "assets", "app.js"), "console.log('hi')", "utf8");

    const app = buildApp(h.service, h.statsService, { logger: false, frontendDistPath: distDir });
    const res = await app.inject({ method: "GET", url: "/assets/app.js" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("console.log('hi')");
    await app.close();
  });

  it("keeps unmatched /api/* routes as real JSON 404s, not the SPA shell", async () => {
    await writeFile(path.join(distDir, "index.html"), "<html><body>panel</body></html>", "utf8");
    const app = buildApp(h.service, h.statsService, { logger: false, frontendDistPath: distDir });

    const res = await app.inject({ method: "GET", url: "/api/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("panel");

    await app.close();
  });

  it("real API routes still work normally alongside static serving", async () => {
    await writeFile(path.join(distDir, "index.html"), "<html></html>", "utf8");
    const app = buildApp(h.service, h.statsService, { logger: false, frontendDistPath: distDir });

    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });

    await app.close();
  });
});
