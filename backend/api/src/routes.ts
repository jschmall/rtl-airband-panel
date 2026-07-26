import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { InstanceService } from "./instance-service.js";
import { parseImportBundle, parseRtlAirbandConfigBody, ShapeValidationError } from "./config-shape.js";

// Applied to every route that writes a config, restarts/renames/creates/deletes an
// instance, or otherwise touches systemd — deliberately much tighter than the global
// default in app.ts, since these are the actions a misbehaving client could use to
// restart-storm every managed instance.
const MUTATING_ROUTE_OPTS = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };

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
