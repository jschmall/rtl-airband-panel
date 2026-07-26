import type { FastifyInstance } from "fastify";
import { ConfigConflictError, InstanceAlreadyExistsError, InstanceNotFoundError, ValidationFailedError } from "./instance-service.js";
import { ShapeValidationError } from "./config-shape.js";
import { InvalidInstanceNameError } from "./instance-name.js";
import { CommandError } from "./systemd/run-command.js";

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
    if (err instanceof InstanceAlreadyExistsError || err instanceof ConfigConflictError) {
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
    // A failed systemd/sudo invocation (unit busy, device unplugged, permission
    // denied, ...) is a routine operational occurrence, not a bug in this
    // service — surface exit code and stderr instead of lumping it in with the
    // generic 500 below, which gave callers zero way to tell "systemctl failed"
    // apart from "this server has a bug".
    if (err instanceof CommandError) {
      request.log.warn(err);
      reply.code(502).send({ error: err.message, exitCode: err.exitCode, stderr: err.stderr });
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
