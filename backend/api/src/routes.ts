import type { FastifyInstance } from "fastify";
import type { RtlAirbandConfig } from "@rtl-airband-panel/parser";
import type { InstanceService } from "./instance-service.js";
import { parseRtlAirbandConfigBody, ShapeValidationError } from "./config-shape.js";

export function registerRoutes(app: FastifyInstance, service: InstanceService): void {
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/instances", async () => service.listInstances());

  app.get<{ Params: { name: string } }>("/instances/:name", async (request) => {
    return service.getConfig(request.params.name);
  });

  app.get<{ Params: { name: string } }>("/instances/:name/health", async (request) => {
    return service.getHealth(request.params.name);
  });

  app.put<{ Params: { name: string } }>("/instances/:name", async (request) => {
    const config = parseRtlAirbandConfigBody(request.body);
    return service.updateConfig(request.params.name, config);
  });

  app.post<{ Params: { name: string } }>("/instances/:name/restart", async (request) => {
    return service.restartInstance(request.params.name);
  });

  app.post<{ Params: { name: string } }>("/instances/:name/rename", async (request) => {
    const { newName } = extractRenameBody(request.body);
    return service.renameInstance(request.params.name, newName);
  });

  app.post("/instances", async (request) => {
    const { name, config } = extractCreateBody(request.body);
    return service.createInstance(name, config);
  });

  app.delete<{ Params: { name: string } }>("/instances/:name", async (request, reply) => {
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
