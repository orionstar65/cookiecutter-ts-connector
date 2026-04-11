/**
 * @file client.ts
 * @description
 *
 *   Every Connector wraps a client library of some kind with authentication
 *   provided by the Access Service (soon to be replaced with the Connector
 *   Gateway).
 *
 *   The purpose of this file is to encapsulate all authentication-related logic
 *   against the underlying System of Record, so that the rest of the Connector
 *   can pass around a standardized, authenticated Client.
 *
 * @see UCP access service Connect schema (`ext/access/v1/org/service`)
 */
import { ServiceConnect } from "@ucp/api-schema-connect/ext/access/v1/org/service_pb.js";

/**
 * @constructor @method connect
 * @description Parses the credentials out of an Access Service response
 * to construct a client in the underlying client library dependency.
 *
 * @param {ServiceConnect} config, returned by the Access Service
 * @returns {any}
 */
async function connect<T>(credential: ServiceConnect): Promise<T> {
  throw new Error("Not Implemented");
}

export default { connect };
