import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import type { Response } from "express";

import { formatErrorBody } from "@ucp/express/middleware/ErrorHandlerMiddleware.js";
import { isClientDisconnect } from "@ucp/express/middleware/RequestAbortController.js";
import {
  ExpressSettings,
  getCurrentSettings,
} from "@ucp/express/settings.js";

/**
 * Options for {@link pipeStreamToResponse}.
 *
 * @property signal
 *   The request-scoped `AbortSignal` (typically
 *   `response.locals.abortSignal`, set by `RequestAbortController`).
 *   When provided it is threaded into `pipeline` so a client disconnect
 *   tears the pump down within one tick instead of draining bytes nobody
 *   is reading. Callers are still responsible for passing the same signal
 *   to the *producer* (e.g. `fetch(..., { signal })`) so the upstream
 *   request cancels too — this helper owns the pipe, not producer-side
 *   cancellation.
 *
 * @property settings
 *   The active `ExpressSettings`, used only to format the pre-headers
 *   500 body (it controls whether the dev-only `stack` is included).
 *   Pass the SAME settings the `Server` — and therefore the terminal
 *   `ErrorHandlerMiddleware` — was constructed with, so the helper's
 *   pre-headers 500 is byte-identical to a terminal-handler 500. Defaults
 *   to `getCurrentSettings()` when omitted: correct for the common case
 *   where settings are derived from `process.env`, but it can DIVERGE
 *   from a `Server` built with hand-constructed settings (e.g. `dev`
 *   forced on/off), so prefer passing it explicitly when the caller has
 *   a settings instance in hand.
 */
export interface PipeStreamOptions {
  signal?: AbortSignal;
  settings?: ExpressSettings;
}

/**
 * Stream a source `Readable` to an Express `Response` with correct
 * error timing for streaming downloads.
 *
 * The hazard this solves: `pipeline(source, response, { signal })`
 * destroys the `response` as part of its own error cleanup. So by the
 * time the `pipeline` rejection surfaces, a source error that happened
 * *before* any byte committed the headers has already left the socket
 * torn down — the terminal `ErrorHandlerMiddleware` can no longer write
 * a clean JSON 5xx, and the client sees a connection reset instead of a
 * `500`. (This generalizes the bespoke guard confluence-connector's
 * `read.ts` carried; see connectors-5kk.)
 *
 * Control flow:
 *   - A `source.once("error", ...)` listener is registered *before*
 *     `pipeline`. It observes the source failure while the response is
 *     still writable and — only if the request was not aborted and no
 *     bytes have committed — emits a clean 500 via the shared
 *     {@link formatErrorBody} formatter. The `!signal?.aborted` check is
 *     load-bearing: a client disconnect must never trigger a 500 write
 *     onto a dying socket.
 *   - `pipeline` then runs. Its rejection is classified:
 *       - a benign abort (signal aborted with a client-disconnect reason)
 *         returns quietly — the central handler logs it at `info` if it
 *         ever surfaces;
 *       - if the pre-headers 500 already fired, the rejection is just
 *         cleanup and is swallowed;
 *       - otherwise (a genuine post-headers failure) the response is
 *         destroyed so the client gets a truncated body rather than a
 *         hung socket with `200 OK` already sent.
 *   - `finally` destroys the source if it is still open, subsuming the
 *     bespoke teardown blocks that azure/file-system/sharepoint reads
 *     carried.
 *
 * This helper owns the pipe and the error timing ONLY. Callers must set
 * the status and content headers *before* calling it, and must perform
 * any producer-side cancellation themselves.
 *
 * @param response The Express response to stream into.
 * @param source   The source stream to pump from.
 * @param options  Optional pipe options (see {@link PipeStreamOptions}).
 */
export async function pipeStreamToResponse(
  response: Response,
  source: Readable | NodeJS.ReadableStream,
  options?: PipeStreamOptions,
): Promise<void> {
  const signal = options?.signal;
  const settings = options?.settings ?? getCurrentSettings();

  // Observe a source error while the response is still writable. This
  // must be an explicit listener rather than relying on the `pipeline`
  // rejection below, because `pipeline` destroys `response` during its
  // error cleanup — by the time the rejection lands the socket is gone
  // and a 5xx can no longer be written.
  // Held in an object so the listener's write is visible to the `catch`
  // below. A plain `let` would be control-flow-narrowed to its `false`
  // initializer by `no-unnecessary-condition`, which cannot see the
  // mutation happening inside the listener closure.
  const state = { earlyErrorHandled: false };
  const readable = source as Readable;
  readable.once("error", (error: Error) => {
    if (
      !signal?.aborted &&
      !response.headersSent &&
      !response.writableEnded &&
      response.writable
    ) {
      state.earlyErrorHandled = true;
      const body = formatErrorBody(error, settings);
      response.status(body.status).json(body);
    }
  });

  try {
    // Pass an options object unconditionally. `stream/promises.pipeline`
    // treats every trailing argument as a stream stage, so a literal
    // `undefined` third arg is interpreted as a (broken) destination and
    // makes the returned promise reject with `ERR_INVALID_ARG_TYPE` —
    // even after the bytes piped through and the response ended. An empty
    // object is the documented "no options" form and pumps cleanly.
    await pipeline(source, response, signal ? { signal } : {});
  } catch (error) {
    // Benign client disconnect: the signal aborted with a
    // client-disconnect reason. Nothing to write to a dead socket; the
    // central handler logs at `info` if this ever surfaces.
    if (signal?.aborted && isClientDisconnect(signal.reason)) {
      return;
    }
    // The pre-headers 500 already went out; the pipeline rejection here
    // is just its destruction cleanup.
    if (state.earlyErrorHandled) {
      return;
    }
    // Genuine post-headers failure: the status is locked, so the best we
    // can do is destroy the response. The client sees a truncated body
    // instead of a socket hung open with `200 OK` already committed.
    if (!response.destroyed) {
      response.destroy(error instanceof Error ? error : undefined);
    }
  } finally {
    if (!readable.destroyed) {
      readable.destroy();
    }
  }
}
