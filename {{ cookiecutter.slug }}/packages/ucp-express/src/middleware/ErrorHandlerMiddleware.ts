import pino from "pino";
import { Request, Response, NextFunction } from "express";
import { HttpError } from "http-errors";
import { getReasonPhrase, ReasonPhrases, StatusCodes } from "http-status-codes";

import { sanitizeStackForLog } from "@ucp/express/logger.js";
import { isClientDisconnect } from "@ucp/express/middleware/RequestAbortController.js";
import { ExpressSettings } from "@ucp/express/settings.js";
import { ErrorHandler } from "@ucp/express/types.js";

/**
 * Build the standard error response body from an error and the active
 * settings. `HttpError`s map to their status/message/reason; anything
 * else collapses to a generic 500 ("Something Broke"). The raw `stack`
 * is included only in dev mode.
 *
 * Extracted as a pure function so the streaming-download helper
 * (`pipeStreamToResponse`) can emit byte-identical pre-headers 5xx
 * bodies without re-implementing this mapping. The terminal
 * `ErrorHandlerMiddleware` and the stream helper are the only callers;
 * keep them consistent by going through here.
 *
 * @see https://stackoverflow.com/a/40560953 for the `...` syntax
 */
export function formatErrorBody(
  err: Error,
  settings: ExpressSettings,
): { message: string; status: number; reason: string; stack?: string } {
  return err instanceof HttpError
    ? {
        message: err.message,
        status: err.statusCode,
        reason: getReasonPhrase(err.statusCode),
        ...(settings.dev && { stack: err.stack }),
      }
    : {
        message: "Something Broke",
        status: StatusCodes.INTERNAL_SERVER_ERROR,
        reason: ReasonPhrases.INTERNAL_SERVER_ERROR,
        ...(settings.dev && { stack: err.stack }),
      };
}

/**
 * @function ErrorHandlerMiddleware
 * @constructor
 * @description Makes an ErrorHandler Middleware that handles errors
 *   gracefully without crashing the service
 *
 * @see https://stackoverflow.com/a/40560953 for the `...` syntax
 */
export default function ErrorHandlerMiddleware(
  settings: ExpressSettings,
  logger: pino.Logger,
): ErrorHandler {
  return function (
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const app = req.app;

    // First-class client-disconnect path. When the caller closes the
    // connection mid-request, `RequestAbortController` aborts
    // `res.locals.abortSignal` with `REASON_CLIENT_DISCONNECT`. Any resulting
    // error (a pipeline AbortError, or an EPIPE / write-after-end from a
    // handler that never read the signal) lands here. This is an expected
    // condition, not a server fault: there is no live socket to write a body
    // to, and it must not be logged at `error` level (benign disconnects would
    // flood the error logs). We key off the *signal* — not the error shape —
    // so it is robust regardless of how the error was wrapped, and it covers
    // handlers that did not plumb the signal into their stream pipeline.
    //
    // We still emit one structured `info` line that carries `err`, so a
    // genuine mid-stream failure that races a disconnect is not silently
    // dropped, and so disconnect rates stay visible at the prod default level.
    // The @ucp/express Locals augmentation declares `abortSignal` as always
    // present, but it is only set by RequestAbortController. Read it as
    // optional so this handler degrades to normal handling when that
    // middleware isn't mounted (other apps, non-instrumented paths, tests).
    const abortSignal = (res.locals as { abortSignal?: AbortSignal })
      .abortSignal;
    if (abortSignal?.aborted && isClientDisconnect(abortSignal.reason)) {
      logger.info(
        { app, req, res, err },
        "client disconnected before response completed",
      );
      return;
    }

    const body = formatErrorBody(err, settings);

    // Error logs intentionally preserve raw URLs that appear inside `err`
    // (notably `err.config.url`, `err.response.url`, and stack frames).
    // `req.url` and `req.query` are still sanitized by the `req`
    // serializer in logger.ts — the privacy boundary is the access log,
    // not the error log. For diagnosing upstream failures the URL is
    // load-bearing context and the observability value is judged to
    // outweigh the residual exposure here.
    //
    // Operators with a compliance reason to hash URLs at the error layer
    // too can flip `APP_LOG_REDACT_ERR_URLS=true`. That flag wires a
    // wrapper around pino's `err` serializer AND scrubs `body.stack`
    // below so the two copies stay consistent. `body.stack` is otherwise
    // a separate copy of `err.stack` that bypasses the err serializer —
    // it only exists when `settings.dev` is true, but we sanitize it
    // anyway when the flag is on so dev-mode logs are not a back door.
    const logBody = body.stack
      ? { ...body, stack: sanitizeStackForLog(body.stack) }
      : body;
    logger.error({ app, req, res, body: logBody, err }, err.name);

    // If the response has already started (e.g. an error or client disconnect
    // during a streaming download, after headers were flushed), we cannot
    // write an error body — `res.status().json()` would throw
    // ERR_HTTP_HEADERS_SENT / write-after-end. Delegate to Express's default
    // error handler, which closes the connection. (Per the Express docs: a
    // custom error handler must delegate once headers have been sent.)
    //
    // Defense-in-depth: a streaming download whose source errors
    // *before* headers commit is torn down by `pipeline`, which destroys
    // `res` as part of its cleanup — leaving `headersSent` false but the
    // socket already ended/non-writable. Writing a 500 there throws a
    // write-after-end. Treat an ended/non-writable response the same as
    // one with headers already sent. (`pipeStreamToResponse` emits the
    // clean 500 itself in that window; this is the backstop.)
    if (res.headersSent || res.writableEnded || !res.writable) {
      next(err);
      return;
    }
    res.status(body.status).json(body);
  };
}
