import { existsSync } from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

/**
 * Serves the frontend's production build (if present) from this same
 * process/port, so the whole app can run as a single instance instead of
 * a separate API + Vite-dev-server pair. A no-op if frontendDistPath
 * doesn't exist (not built yet, or you're intentionally running the
 * frontend separately via `npm run dev --workspace=frontend`) -- returns
 * false so the caller can log that.
 */
export function registerFrontend(app: FastifyInstance, frontendDistPath: string): boolean {
  if (!existsSync(path.join(frontendDistPath, "index.html"))) {
    return false;
  }

  app.register(fastifyStatic, { root: frontendDistPath });

  // SPA fallback: any unmatched GET outside /api (including a missing
  // static asset, which @fastify/static also routes here) serves
  // index.html, so client-side routes work on direct navigation/refresh,
  // not just from in-app links. Unmatched /api/* requests stay real 404s.
  app.setNotFoundHandler((request, reply) => {
    if (request.method !== "GET" || request.url.startsWith("/api/")) {
      reply.code(404).send({ error: "Not found" });
      return;
    }
    reply.sendFile("index.html");
  });

  return true;
}
