import Fastify, { LogController, type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { InstanceService } from "./instance-service.js";
import type { StatsService } from "./stats/stats-service.js";
import { registerRoutes } from "./routes.js";
import { registerStatsRoutes } from "./stats-routes.js";
import { installErrorHandler } from "./error-handler.js";
import { registerFrontend } from "./static-frontend.js";

export function buildApp(
  service: InstanceService,
  statsService: StatsService,
  options: { logger?: boolean; logLevel?: string; frontendDistPath?: string } = {}
): FastifyInstance {
  // logController.disableRequestLogging: Fastify's default logger otherwise
  // emits an "incoming request"/"request completed" JSON line for every
  // HTTP request, which drowns out the deliberate audit/warn/error logging
  // below under routine polling traffic (instance list, stats, /metrics
  // scraping every ~15-20s). Mutating actions still get their own explicit
  // auditLog line in routes.ts, so nothing about *what happened* is lost --
  // just the per-poll noise.
  const app = Fastify({
    logger: options.logger === false ? false : { level: options.logLevel ?? "info" },
    logController: new LogController({ disableRequestLogging: true }),
  });
  installErrorHandler(app);

  // Every response carries the same request id Fastify's own logger already
  // tags every log line for this request with, so a client-reported problem
  // ("my save failed just now") can be tied back to the exact server log
  // lines -- including the audit log line routes.ts writes for mutating
  // actions -- without guessing by timestamp.
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    return payload;
  });

  // Basic security headers (clickjacking/MIME-sniffing protection, etc.). No
  // CORS plugin is registered on purpose: this app is same-origin in both
  // deployment modes (single-process serving, or Vite's dev-server proxy),
  // so the browser's default same-origin policy already blocks cross-origin
  // requests from another site — adding a permissive CORS policy here would
  // weaken that, not strengthen it, given there's no auth layer yet to fall
  // back on.
  app.register(helmet);

  // A generous global default so normal UI polling (instance list, health,
  // stats) never trips it, plus a much tighter override on the handful of
  // mutating/restart-triggering routes registered in routes.ts — there's no
  // auth yet, so this is the only thing standing between a misbehaving
  // client and restart-storming every managed instance.
  app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  // Deliberately at the root, not under /api -- this is the path every
  // Prometheus-compatible scraper defaults to, and a scrape target normally
  // isn't namespaced under an app-specific prefix. Safe alongside the SPA
  // catch-all below: that's a setNotFoundHandler, which only ever fires when
  // no real route (like this one) matched.
  app.get("/metrics", async (request, reply) => {
    reply.type("text/plain; version=0.0.4; charset=utf-8");
    return statsService.metricsText();
  });

  // Namespaced under /api so it never collides with the frontend's own
  // client-side routes (e.g. /instances/:name is also a React Router page).
  app.register(
    async (scoped) => {
      // Lives here rather than in routes.ts because it needs both services.
      scoped.get("/health", async (request, reply) => {
        const { ready, checks } = await statsService.checkReadiness();
        reply.code(ready ? 200 : 503);
        return { status: ready ? "ok" : "degraded", checks };
      });
      registerRoutes(scoped, service);
      registerStatsRoutes(scoped, statsService);
    },
    { prefix: "/api" }
  );

  if (options.frontendDistPath) {
    const served = registerFrontend(app, options.frontendDistPath);
    if (!served) {
      app.log.warn(
        `No frontend build found at ${options.frontendDistPath} -- serving API only. ` +
          `Run 'npm run build --workspace=frontend' to enable single-process mode, ` +
          `or run the frontend separately (npm run dev --workspace=frontend).`
      );
    }
  }

  return app;
}
