import type { FastifyInstance } from "fastify";
import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { InstanceService } from "./instance-service.js";
import { parseRtlAirbandConfigBody, ShapeValidationError } from "./config-shape.js";

// Applied to every route that writes a config, restarts/renames/creates/deletes an
// instance, or otherwise touches systemd — deliberately much tighter than the global
// default in app.ts, since these are the actions a misbehaving client could use to
// restart-storm every managed instance.
const MUTATING_ROUTE_OPTS = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };

export function registerRoutes(app: FastifyInstance, service: InstanceService): void {
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/instances", async () => service.listInstances());

  app.get<{ Params: { name: string } }>("/instances/:name", async (request) => {
    return service.getConfig(request.params.name);
  });

  app.get<{ Params: { name: string } }>("/instances/:name/health", async (request) => {
    return service.getHealth(request.params.name);
  });

  app.put<{ Params: { name: string }; Querystring: { restart?: string } }>(
    "/instances/:name",
    MUTATING_ROUTE_OPTS,
    async (request) => {
      const config = parseRtlAirbandConfigBody(request.body);
      const restart = request.query.restart !== "false";
      return service.updateConfig(request.params.name, config, { restart });
    }
  );

  app.post<{ Params: { name: string } }>("/instances/:name/restart", MUTATING_ROUTE_OPTS, async (request) => {
    return service.restartInstance(request.params.name);
  });

  app.post<{ Params: { name: string } }>("/instances/:name/rename", MUTATING_ROUTE_OPTS, async (request) => {
    const { newName } = extractRenameBody(request.body);
    return service.renameInstance(request.params.name, newName);
  });

  app.post("/instances", MUTATING_ROUTE_OPTS, async (request) => {
    const { name, config } = extractCreateBody(request.body);
    return service.createInstance(name, config);
  });

  app.delete<{ Params: { name: string } }>("/instances/:name", MUTATING_ROUTE_OPTS, async (request, reply) => {
    await service.deleteInstance(request.params.name);
    reply.code(204);
  });
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
