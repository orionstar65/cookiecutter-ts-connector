import type { Request, Response, NextFunction } from "express";

/**
 * Request-scoped cancellation primitive.
 *
 * Creates one `AbortController` per HTTP request, exposes it as
 * `response.locals.abortSignal`, and aborts whenever the response is
 * closed/errored by the upstream caller before completion. Handlers
 * that produce streams (downloads, PDF conversion, any long-running
 * fetch) MUST plumb this signal into:
 *   - the underlying `fetch(..., { signal })` so the producer cancels
 *   - `Readable.fromWeb(body, { signal })` so the Node stream destroys
 *     deterministically on abort
 *   - `pipeline(src, dst, { signal })` so pump cleanup is bound to lifetime
 *
 * Lifetime guarantee: when this signal aborts, every fetch and every
 * pipeline observing it tears down within one tick. No abort timer can
 * outlive the request.
 *
 * Auto-mounted by `Server` so every connector receives the signal by
 * construction. Handlers that don't read it behave exactly as today.
 */
declare module "express-serve-static-core" {
  interface Locals {
    abortController: AbortController;
    abortSignal: AbortSignal;
  }
}

/**
 * Stable abort reason for client disconnects. Producers should abort
 * with this constant for ergonomics and stable stack traces. Consumers
 * MUST match by SHAPE via `isClientDisconnect(reason)`, not by identity
 * — identity does not survive cross-module-instance comparisons.
 */
export const REASON_CLIENT_DISCONNECT: DOMException = new DOMException(
  "client closed connection",
  "AbortError",
);

/**
 * Type-guard for client-disconnect aborts. Use this instead of identity
 * comparison against `REASON_CLIENT_DISCONNECT` so checks travel
 * cleanly across module instances and minor library upgrades.
 */
export function isClientDisconnect(reason: unknown): boolean {
  return (
    reason instanceof DOMException &&
    reason.name === "AbortError" &&
    reason.message === "client closed connection"
  );
}

export default function RequestAbortController() {
  return function (_req: Request, res: Response, next: NextFunction) {
    const controller = new AbortController();
    res.locals.abortController = controller;
    res.locals.abortSignal = controller.signal;

    // 'close' can fire BEFORE 'finish' on HTTP/2 RST-after-end and on
    // HTTP/1.1 with explicit `Connection: close`. Use both
    // `res.writableEnded` and a local `finished` flag to detect a
    // clean response — only abort when neither indicates one.
    let finished = false;

    const onClose = () => {
      if (!finished && !res.writableEnded && !controller.signal.aborted) {
        controller.abort(REASON_CLIENT_DISCONNECT);
      }
    };
    const onError = (err: Error) => {
      if (!controller.signal.aborted) controller.abort(err);
    };
    const onFinish = () => {
      finished = true;
      res.off("close", onClose);
      res.off("error", onError);
      res.off("finish", onFinish);
    };

    res.on("close", onClose);
    res.on("error", onError);
    res.on("finish", onFinish);

    next();
  };
}
