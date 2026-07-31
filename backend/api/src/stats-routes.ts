import type { FastifyInstance } from "fastify";
import type { StatsService } from "./stats/stats-service.js";
import type { HistoryQuery } from "./stats/store.js";
import { ShapeValidationError } from "./config-shape.js";

interface HistoryQuerystring {
  metric?: string;
  labels?: string;
  sinceMs?: string;
  untilMs?: string;
}

export function registerStatsRoutes(app: FastifyInstance, statsService: StatsService): void {
  // Registered as a literal route ahead of /instances/:name/stats/... --
  // "stats-summary" is reserved in instance-name.ts so it can never collide
  // with a real instance name.
  app.get("/instances/stats-summary", async () => statsService.latestSummaries());

  app.get<{ Params: { name: string } }>("/instances/:name/stats/latest", async (request) => {
    return statsService.latest(request.params.name);
  });

  app.get<{ Params: { name: string } }>("/instances/:name/stats/poll-status", async (request) => {
    return statsService.getPollStatus(request.params.name);
  });

  app.get<{ Params: { name: string }; Querystring: HistoryQuerystring }>(
    "/instances/:name/stats/history",
    async (request) => {
      const { metric, labels, sinceMs, untilMs } = request.query;
      if (!metric) {
        throw new ShapeValidationError("Expected 'metric' query parameter", "$.query");
      }

      const query: HistoryQuery = { metric };
      if (labels !== undefined) {
        try {
          query.labels = JSON.parse(labels) as Record<string, string>;
        } catch {
          throw new ShapeValidationError("Expected 'labels' query parameter to be valid JSON", "$.query");
        }
      }
      if (sinceMs !== undefined) query.sinceMs = Number(sinceMs);
      if (untilMs !== undefined) query.untilMs = Number(untilMs);

      return statsService.history(request.params.name, query);
    }
  );
}
