import type { FastifyInstance } from "fastify";
import { InstanceAlreadyExistsError, InstanceNotFoundError, ValidationFailedError } from "./instance-service.js";
import { ShapeValidationError } from "./config-shape.js";
import { InvalidInstanceNameError } from "./instance-name.js";

export function installErrorHandler(app: FastifyInstance): void {
  // Fastify 5's setErrorHandler defaults its error generic to `unknown`
  // (previously implicitly typed); this codebase's error handler always
  // receives an Error-like value (thrown domain errors or Fastify's own
  // request-lifecycle errors), optionally carrying a statusCode.
  app.setErrorHandler<Error & { statusCode?: number }>((err, request, reply) => {
    if (err instanceof InstanceNotFoundError) {
      reply.code(404).send({ error: err.message });
      return;
    }
    if (err instanceof InstanceAlreadyExistsError) {
      reply.code(409).send({ error: err.message });
      return;
    }
    if (err instanceof ValidationFailedError) {
      reply.code(422).send({ error: err.message, errors: err.errors });
      return;
    }
    if (err instanceof ShapeValidationError || err instanceof InvalidInstanceNameError) {
      reply.code(400).send({ error: err.message });
      return;
    }
    // Fastify's own errors (malformed JSON, bad content-type, etc.) already
    // carry the right client-error status — pass it through instead of
    // masking a 4xx as a 500.
    if (typeof err.statusCode === "number" && err.statusCode >= 400 && err.statusCode < 500) {
      reply.code(err.statusCode).send({ error: err.message });
      return;
    }
    request.log.error(err);
    reply.code(500).send({ error: "Internal server error" });
  });
}
