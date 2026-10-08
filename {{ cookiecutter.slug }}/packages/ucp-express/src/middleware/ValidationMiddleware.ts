import { Request, Response, NextFunction } from "express";
import HttpError from "http-errors";
import { StatusCodes } from "http-status-codes";
import { type DescMessage, fromJson, JsonObject } from "@bufbuild/protobuf";

import { MiddlewareHandler } from "@ucp/express/types.js";

export interface ValidationOptions {
  body?: DescMessage;
  query?: DescMessage;
}

// prettier-ignore
export default function ValidationMiddleware(options?: ValidationOptions): MiddlewareHandler {
  return function (
    request: Request,
    response: Response,
    next: NextFunction,
  ) {
    // Try to parse request.body if we're configured
    if (options?.body) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      try { fromJson(options.body, request.body); }
      catch (err) { next(HttpError(StatusCodes.BAD_REQUEST, err as Error)); }
    }

    // Try to parse the query if we're configured
    if (options?.query) {
      try { fromJson(options.query, request.query as JsonObject); }
      catch (err) { next(HttpError(StatusCodes.BAD_REQUEST, err as Error)); }
    }

    next();
  }
}
