import { Request, Response, NextFunction } from "express";
import { ReasonPhrases, StatusCodes } from "http-status-codes";

import * as auth from "@ucp/express/auth.js";
import { MiddlewareHandler } from "@ucp/express/types.js";

/**
 * @function AuthenticationMiddleware
 * @constructor
 * @description Makes a middleware that verifies request authorization.
 */
export default function AuthenticationMiddleware(): MiddlewareHandler {
  return function (request: Request, response: Response, next: NextFunction) {
    const authHeader = request.header("Authorization")?.toString();
    const accessToken = auth.parseBearerToken(authHeader);

    if (!(accessToken && auth.verify(accessToken))) {
      response
        .status(StatusCodes.UNAUTHORIZED)
        .json({
          code: StatusCodes.UNAUTHORIZED,
          status: ReasonPhrases.UNAUTHORIZED,
          time: Date.now(),
        });
      return;
    }

    next();
  };
}
