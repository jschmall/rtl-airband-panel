import Fastify, { type FastifyInstance } from "fastify";
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
  options: { logger?: boolean; frontendDistPath?: string } = {}
): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });
  installErrorHandler(app);

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

  // Namespaced under /api so it never collides with the frontend's own
  // client-side routes (e.g. /instances/:name is also a React Router page).
  app.register(
    async (scoped) => {
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
