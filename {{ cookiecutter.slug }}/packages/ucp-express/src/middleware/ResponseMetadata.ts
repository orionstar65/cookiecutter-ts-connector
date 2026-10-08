import * as uuid from "uuid";

import { Request, Response, NextFunction } from "express";

import { MiddlewareHandler } from "@ucp/express/types.js";

/**
 * @function ResponseMetadata
 * @constructor
 * @description Makes a Middleware attaches metadata to response.locals.
 */
export default function ResponseMetadata(): MiddlewareHandler {
  return function (request: Request, response: Response, next: NextFunction) {
    response.locals.id = uuid.v4();
    response.locals.startTimeMs = Date.now();
    response.setHeaders(
      new Map([
        ["X-Request-Id", request.header("X-Request-Id")],
        ["X-Response-Id", response.locals.id],
      ]),
    );

    next();
  };
}
