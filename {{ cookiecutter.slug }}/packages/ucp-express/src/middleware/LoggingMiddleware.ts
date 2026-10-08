import * as uuid from "uuid";

import pino from "pino";
import { Request, Response, NextFunction } from "express";

import { MiddlewareHandler } from "@ucp/express/types.js";

/**
 * @function LoggingMiddleware
 * @constructor
 * @description Makes a Middleware that logs request and response metadata.
 *
 * @param {pino.Logger} logger through which to emit log messages.
 */
export default function LoggingMiddleware(
  logger: pino.Logger,
): MiddlewareHandler {
  const healthchecks = ["/alive", "/ready", "/metrics", "/stats", "/health"];

  return function (req: Request, res: Response, next: NextFunction) {
    const { app } = req;

    // Attach a response-level logger to the response.locals
    res.locals.logger = logger.child({ scope: "response" });

    // Ensure the x-request-id header is set for tracing.
    req.headers["x-request-id"] = req.header("x-request-id") ?? uuid.v4();

    // Filter out healthchecks
    // TODO: Figure out how to make this more configurable if needed.
    if (!healthchecks.includes(req.url)) {
      // Always log info on incoming requests.

      logger.info({ req }, "request received");

      // Once we trigger the next middleware, we can't come back.
      // Schedule a logging callback when the response finishes.
      res.on("finish", () => {
        /*
        When mapping HTTP status codes to log levels, generally:

          1xx (Information)  | "INFO"    | like Continue
          2xx (Success)      | "INFO"    | Indicates a successful request execution.
          3xx (Redirection)  | "INFO"    | usually considered normal behavior.
          4xx (Client Error) | "WARNING" | Client Unauthorized or Bad Request.
          5xx (Server Error) | "ERROR"   | Server Error. We should Investigate.

        */
        if (res.statusCode < 400) logger.info({ app, req, res }, "responded");
        else if (res.statusCode < 500)
          logger.warn({ app, req, res }, "responded");
        else logger.error({ app, req, res }, "responded");
      });
    }

    next();
  };
}
