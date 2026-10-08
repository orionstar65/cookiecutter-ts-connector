import * as uuid from "uuid";

import { Pool, RetryAgent } from "undici";
import { Request, Response, NextFunction } from "express";
import createError from "http-errors";
import { StatusCodes } from "http-status-codes";

import * as pb from "@bufbuild/protobuf";
import * as schemas from "@ucp/api-schema-connect/ext/access/v1/org/service_pb.js";

import * as auth from "@ucp/express/auth.js";
import { AppSettings } from "@ucp/express/settings.js";
import { MiddlewareHandler } from "@ucp/express/types.js";
import { JsonValue } from "@bufbuild/protobuf";

/**
 * @function RemoteAccessMiddleware
 * @constructor
 *
 * @description Constructs a middleware that pulls its connector credential
 * from the AccessService.
 *
 * @note This middleware _should_ follow Authenticated in the middleware chain so
 * that we have already verified the token.
 */
export default function RemoteAccessMiddleware(
  settings: AppSettings,
): MiddlewareHandler {
  // Pool requires a bare origin; basePath is prepended per-request below.
  const url = new URL("/api/access/v1alpha1", settings.root.toString());
  const origin = url.origin;
  const basePath = url.pathname;
  const pool = new Pool(origin);
  const accessService = new RetryAgent(pool, {
    maxRetries: 5,
    minTimeout: 500,
    maxTimeout: 30_000,
    timeoutFactor: 2,
  });

  return async function (
    request: Request,
    response: Response,
    next: NextFunction,
  ) {
    // Authenticate with the AccessService
    const authHeader = request.header("Authorization")?.toString();
    const accessToken = auth.parseBearerToken(authHeader);
    if (!accessToken || accessToken == "")
      next(createError(StatusCodes.UNAUTHORIZED, "No Access Token"));

    // Get the Connector Credential if you can
    const { connectorId } = request.params;
    if (!connectorId || connectorId == "")
      next(createError(StatusCodes.BAD_REQUEST, "Not A Connector"));

    // Parse the access response into response.locals
    try {
      const { statusCode, body } = await accessService.request({
        method: "GET",
        // undici's `path` is the full request path; prepend basePath here.
        path: `${basePath}/service-connects/${connectorId}`,
        headers: {
          "X-Request-Id": request.get("X-Request-Id") ?? uuid.v4(),
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (statusCode < 200 || statusCode >= 300) {
        const text = await body.text();
        throw createError(statusCode, text);
      }

      const serviceConnect = (await body.json()) as { data: JsonValue };

      // Validate the access response with pb
      const access = pb.fromJson(
        schemas.ServiceConnectSchema,
        serviceConnect.data,
      );
      response.locals.connectorId = connectorId;
      response.locals.access = access;
      response.locals.authority = access.authority;
      response.locals.credential = access.connectConfig;

      next();
    } catch (err) {
      next(err);
    }
  };
}
