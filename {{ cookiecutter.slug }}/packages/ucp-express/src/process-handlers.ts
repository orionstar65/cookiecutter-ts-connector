import type pino from "pino";

/**
 * Production-grade process-level error handlers.
 *
 * Node's default behavior on `uncaughtException` is to print the stack
 * to stderr and exit. In a containerized deployment that costs us:
 *   - stderr is not part of the StackDriver-compatible JSON pipeline
 *     (the logger writes structured JSON to stdout; stderr lands as
 *     plain text in log aggregation and we lose structured context).
 *   - `process.stdout.write` is async-buffered when stdout is a pipe
 *     (always true in containers); a `process.exit()` immediately
 *     after a fatal log can drop the buffered line before kernel
 *     flush.
 *   - k8s restarts the pod with no breadcrumb of *why*.
 *
 * This module ensures every uncaught error is logged through the app
 * logger before the process exits. The exit is intentional — Node's
 * docs warn that resuming after `uncaughtException` puts the process
 * in undefined state. We log, give the stdout buffer one tick to
 * drain, then exit; k8s restarts cleanly.
 *
 * `unhandledRejection` is treated symmetrically (log fatal + exit).
 * Logging-only would *prevent* Node's default escalation to
 * `uncaughtException` under `--unhandled-rejections=throw`, leaving
 * the pod limping with broken state. We want loud failure.
 *
 * Auto-installed by `Server.start()` so every connector inherits the
 * safety net by construction. Calling this directly is also
 * supported — it is idempotent enough for tests but each call adds a
 * listener, so production callers should rely on the auto-install
 * inside `Server.start()` and not invoke this twice.
 *
 * @see https://nodejs.org/api/process.html#warning-using-uncaughtexception-correctly
 */
export function installProcessHandlers(logger: pino.Logger): void {
  process.on("uncaughtException", (err, origin) => {
    logger.fatal({ err, origin }, "uncaughtException — process will exit");
    setImmediate(() => process.exit(1));
  });

  process.on("unhandledRejection", (reason) => {
    logger.fatal({ reason }, "unhandledRejection — process will exit");
    setImmediate(() => process.exit(1));
  });
}
