import fs from "fs";

import * as pb from "@bufbuild/protobuf";
import * as schemas from "@ucp/api-schema-connect/ext/access/v1/org/service_pb.js";

import { MiddlewareHandler } from "@ucp/express/types.js";
import { JsonValue } from "@bufbuild/protobuf";

/**
 * @function LocalAccessMiddleware
 * @constructor
 * @description Constructs a middleware that pulls its credentials a local secrets
 * volume (usually mounted in docker-compose.yaml).
 *
 * @requires process.env.APP_ACCESS_CONFIG_PATH to be set.
 * @requires process.env.APP_ACCESS_CONFIG_PATH to contain a valid ServiceConnect.
 *
 * @constructor
 */
export default function LocalAccessMiddleware(): MiddlewareHandler {
  // Validate the local secret is a valid access service ServiceConnect response
  const blob = fs.readFileSync(process.env.APP_ACCESS_CONFIG_PATH!, "utf8");
  const serviceConnect = JSON.parse(blob) as { data: schemas.ServiceConnect };
  const access = pb.fromJson(
    schemas.ServiceConnectSchema,
    serviceConnect.data as unknown as JsonValue,
  );

  return function (request, response, next) {
    response.locals.connectorId = request.params.connectorId;
    response.locals.access = access;
    response.locals.authority = access.authority;
    response.locals.credential = access.connectConfig;
    next();
  };
}
