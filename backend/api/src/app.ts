import Fastify, { type FastifyInstance } from "fastify";
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
