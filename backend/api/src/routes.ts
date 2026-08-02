import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { InstanceService } from "./instance-service.js";
import { parseImportBundle, parseRtlAirbandConfigBody, ShapeValidationError } from "./config-shape.js";
import { CommandError } from "./systemd/run-command.js";

// Applied to every route that writes a config, restarts/renames/creates/deletes an
// instance, or otherwise touches systemd — deliberately much tighter than the global
// default in app.ts, since these are the actions a misbehaving client could use to
// restart-storm every managed instance. Each route registered with this gets its own
// independent 60/min bucket (per client IP) -- e.g. "restart" and "save config" don't
// share a budget -- but that budget IS shared across every instance for that one
// action, since Fastify registers one parameterized route (/instances/:name/restart),
// not one per literal instance name. 60 (not the original 20) was chosen so a real
// multi-instance batch operation -- restarting or re-saving most/all of a ~12-instance
// deployment in one sitting -- comfortably fits without tripping this, while a genuine
// runaway/malicious client still hits the ceiling within seconds.
const MUTATING_ROUTE_OPTS = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };

/**
 * There's no per-user identity to log (no auth layer yet), but "what changed
 * on this instance and when" is still answerable this way: every
 * config-mutating action logs one structured, greppable line — success or
 * failure — tagged `audit: true` and carrying the same request id the
 * x-request-id response header exposes (see app.ts), so a reported problem
 * can be traced to the exact action that caused it.
 */
function auditLog(request: FastifyRequest, action: string, instance: string, outcome: "success" | "failure", extra: Record<string, unknown> = {}): void {
  request.log.info({ audit: true, action, instance, outcome, ...extra }, `audit: ${action} ${instance} ${outcome}`);
}

export function registerRoutes(app: FastifyInstance, service: InstanceService): void {
  app.get("/instances", async () => service.listInstances());

  // Static routes, not `/instances/:name` -- a faithful (unredacted) backup/restore
  // of every instance, for migrating hosts or backing up before a risky change.
  // "export" and "import" are reserved instance names (see instance-name.ts) so
  // these can never be shadowed by, or shadow, a real instance's own route.
  app.get("/instances/export", async () => service.exportAll());

  app.post("/instances/import", MUTATING_ROUTE_OPTS, async (request) => {
    const bundle = parseImportBundle(request.body);
    const results = await service.importAll(bundle);
    for (const [name, result] of Object.entries(results)) {
      auditLog(request, "import", name, result.status === "failed" ? "failure" : "success", {
        status: result.status,
        ...(result.status === "failed" ? { error: result.error } : {}),
      });
    }
    return results;
  });

  app.get<{ Params: { name: string } }>("/instances/:name", async (request, reply) => {
    const { config, version } = await service.getConfigWithVersion(request.params.name);
    reply.header("etag", version);
    return config;
  });

  // Deliberately separate from GET /instances/:name (which always redacts) -- the
  // frontend calls this only when the user clicks "Show" on a field still holding the
  // redaction sentinel, so an explicit reveal stays a rare, auditable action rather
  // than something a routine config fetch could leak.
  app.get<{ Params: { name: string } }>("/instances/:name/secrets", async (request) => {
    const config = await service.getSecrets(request.params.name);
    auditLog(request, "reveal-secrets", request.params.name, "success");
    return config;
  });

  app.get<{ Params: { name: string } }>("/instances/:name/health", async (request) => {
    return service.getHealth(request.params.name);
  });

  // Static sibling of /instances/:name/health (see instance-name.ts's
  // RESERVED_NAMES) -- every instance's health in one request, so a client
  // polling the whole list (the sidebar) doesn't have to fan out to N
  // per-instance requests, each of which is its own `sudo systemctl show`
  // invocation under systemd-mode=sudo.
  app.get("/instances/health", async () => service.getAllHealth());

  app.get<{ Params: { name: string }; Querystring: { lines?: string } }>("/instances/:name/logs", async (request) => {
    const lines = request.query.lines !== undefined ? Number(request.query.lines) : undefined;
    const result = { lines: await service.getLogs(request.params.name, lines) };
    auditLog(request, "view-logs", request.params.name, "success");
    return result;
  });

  // Read-only, same as /logs above -- stays under the global rate-limit default
  // rather than MUTATING_ROUTE_OPTS, which exists specifically for actions that
  // can restart-storm units. A long-lived connection only ever counts as the one
  // request that opened it, regardless of how long it stays open.
  app.get<{ Params: { name: string }; Querystring: { lines?: string } }>("/instances/:name/logs/stream", async (request, reply) => {
    const lines = request.query.lines !== undefined ? Number(request.query.lines) : undefined;

    // Fastify stops managing this reply after hijack() -- its own onSend hooks
    // (helmet headers, x-request-id) no longer run, so anything that matters
    // gets written manually below.
    reply.hijack();
    reply.raw.setHeader("x-request-id", request.id);
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      // nginx-specific opt-out of response buffering -- defense-in-depth
      // alongside the reverse-proxy config documented in the README; without
      // one or the other, a proxied deployment gets delayed bursts instead
      // of a live stream.
      "X-Accel-Buffering": "no",
    });
    // Node doesn't send headers until the first write() otherwise -- without this,
    // a quiet unit with no backlog would leave the client's connection looking
    // unopened (no onopen/response headers) until the first heartbeat.
    reply.raw.flushHeaders();
    auditLog(request, "stream-logs", request.params.name, "success");

    const controller = new AbortController();
    reply.raw.on("close", () => controller.abort());
    reply.raw.on("error", () => controller.abort());

    // Keeps any intermediary (proxy, load balancer) that treats a quiet
    // connection as dead from closing it during a lull in journal activity.
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(": ping\n\n");
    }, 15_000);

    try {
      for await (const line of service.followLogs(request.params.name, lines, controller.signal)) {
        if (reply.raw.writableEnded) break;
        reply.raw.write(`data: ${JSON.stringify(line)}\n\n`);
      }
    } catch (err) {
      // A failed journalctl invocation is a routine operational occurrence
      // (unit removed mid-stream, systemd/sudo denial, ...), same as any
      // other CommandError -- installErrorHandler can't see this one (the
      // reply was hijacked before it could throw), so log and shape the
      // payload the same way it does for every other route.
      if (err instanceof CommandError) request.log.warn(err);
      auditLog(request, "stream-logs", request.params.name, "failure", { error: errorMessage(err) });
      // Named "stream-error" rather than the bare SSE default -- EventSource's
      // own connection-failure event is also called "error", so reusing that
      // name here would make a single client-side listener receive both native
      // transport failures and this application-level message, indistinguishable
      // without extra checks.
      if (!reply.raw.writableEnded) {
        const detail =
          err instanceof CommandError
            ? { message: err.message, exitCode: err.exitCode, stderr: err.stderr }
            : { message: errorMessage(err) };
        reply.raw.write(`event: stream-error\ndata: ${JSON.stringify(detail)}\n\n`);
      }
    } finally {
      clearInterval(heartbeat);
      controller.abort();
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  });

  app.post<{ Params: { name: string } }>("/instances/:name/validate", async (request) => {
    const config = parseRtlAirbandConfigBody(request.body);
    return service.validateOnly(request.params.name, config);
  });

  app.put<{ Params: { name: string }; Querystring: { restart?: string } }>(
    "/instances/:name",
    MUTATING_ROUTE_OPTS,
    async (request) => {
      const config = parseRtlAirbandConfigBody(request.body);
      const restart = request.query.restart !== "false";
      const ifMatchHeader = request.headers["if-match"];
      const ifMatch = typeof ifMatchHeader === "string" ? { ifMatch: ifMatchHeader } : {};
      try {
        const result = await service.updateConfig(request.params.name, config, { restart, ...ifMatch });
        auditLog(request, "update-config", request.params.name, "success", { restart, warnings: result.warnings.length });
        return result;
      } catch (err) {
        auditLog(request, "update-config", request.params.name, "failure", { restart, error: errorMessage(err) });
        throw err;
      }
    }
  );

  // Separate from PUT's own restart-boolean query param rather than a third
  // value for it, so PUT's WriteResult response contract stays stable
  // regardless of query value -- this returns the differently-shaped
  // ApplyLiveResult instead. Mirrors POST .../restart's relationship to
  // PUT's restart:true — a dedicated action endpoint alongside the generic save.
  app.post<{ Params: { name: string } }>("/instances/:name/apply-live", MUTATING_ROUTE_OPTS, async (request) => {
    const config = parseRtlAirbandConfigBody(request.body);
    const ifMatchHeader = request.headers["if-match"];
    const ifMatch = typeof ifMatchHeader === "string" ? { ifMatch: ifMatchHeader } : {};
    try {
      const result = await service.applyConfigLive(request.params.name, config, ifMatch);
      auditLog(request, "apply-live", request.params.name, "success", {
        attempted: result.liveApply.attempted,
        ...(result.liveApply.attempted
          ? { applied: result.liveApply.applied.length, skipped: result.liveApply.skippedRequiresRestart.length }
          : { reason: result.liveApply.reason }),
      });
      return result;
    } catch (err) {
      auditLog(request, "apply-live", request.params.name, "failure", { error: errorMessage(err) });
      throw err;
    }
  });

  app.patch<{ Params: { name: string } }>("/instances/:name/options", MUTATING_ROUTE_OPTS, async (request) => {
    const patch = extractInstanceOptionsPatch(request.body);
    try {
      const result = await service.updateInstanceOptions(request.params.name, patch);
      auditLog(request, "update-options", request.params.name, "success", { ...patch });
      return result;
    } catch (err) {
      auditLog(request, "update-options", request.params.name, "failure", { ...patch, error: errorMessage(err) });
      throw err;
    }
  });

  app.post<{ Params: { name: string } }>("/instances/:name/restart", MUTATING_ROUTE_OPTS, async (request) => {
    try {
      const result = await service.restartInstance(request.params.name);
      auditLog(request, "restart", request.params.name, "success");
      return result;
    } catch (err) {
      auditLog(request, "restart", request.params.name, "failure", { error: errorMessage(err) });
      throw err;
    }
  });

  // A static route, not `/instances/:name/...` -- restarts every instance currently
  // pending-restart in one call instead of one request per instance.
  app.post("/instances/restart-pending", MUTATING_ROUTE_OPTS, async (request) => {
    const results = await service.restartAllPending();
    for (const [name, result] of Object.entries(results)) {
      if ("error" in result) {
        auditLog(request, "restart", name, "failure", { bulk: true, error: result.error });
      } else {
        auditLog(request, "restart", name, "success", { bulk: true });
      }
    }
    return results;
  });

  app.post<{ Params: { name: string } }>("/instances/:name/rename", MUTATING_ROUTE_OPTS, async (request) => {
    const { newName } = extractRenameBody(request.body);
    try {
      const result = await service.renameInstance(request.params.name, newName);
      auditLog(request, "rename", request.params.name, "success", { newName });
      return result;
    } catch (err) {
      auditLog(request, "rename", request.params.name, "failure", { newName, error: errorMessage(err) });
      throw err;
    }
  });

  app.post("/instances", MUTATING_ROUTE_OPTS, async (request) => {
    const { name, config } = extractCreateBody(request.body);
    try {
      const result = await service.createInstance(name, config);
      auditLog(request, "create", name, "success");
      return result;
    } catch (err) {
      auditLog(request, "create", name, "failure", { error: errorMessage(err) });
      throw err;
    }
  });

  app.delete<{ Params: { name: string } }>("/instances/:name", MUTATING_ROUTE_OPTS, async (request, reply) => {
    try {
      await service.deleteInstance(request.params.name);
      auditLog(request, "delete", request.params.name, "success");
      reply.code(204);
    } catch (err) {
      auditLog(request, "delete", request.params.name, "failure", { error: errorMessage(err) });
      throw err;
    }
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function extractCreateBody(body: unknown): { name: string; config: RtlAirbandConfig } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ShapeValidationError("Expected an object", "$");
  }
  const rec = body as Record<string, unknown>;
  if (typeof rec["name"] !== "string") {
    throw new ShapeValidationError("Expected 'name' to be a string", "$");
  }
  return { name: rec["name"], config: parseRtlAirbandConfigBody(rec["config"]) };
}

function extractInstanceOptionsPatch(body: unknown): { jsonLogging?: boolean } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ShapeValidationError("Expected an object", "$");
  }
  const rec = body as Record<string, unknown>;
  if (rec["jsonLogging"] === undefined) return {};
  if (typeof rec["jsonLogging"] !== "boolean") {
    throw new ShapeValidationError("Expected 'jsonLogging' to be a boolean", "$");
  }
  return { jsonLogging: rec["jsonLogging"] };
}

function extractRenameBody(body: unknown): { newName: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ShapeValidationError("Expected an object", "$");
  }
  const rec = body as Record<string, unknown>;
  if (typeof rec["newName"] !== "string") {
    throw new ShapeValidationError("Expected 'newName' to be a string", "$");
  }
  return { newName: rec["newName"] };
}
