import http from "http";
import * as uuid from "uuid";

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";

import * as schemas from "@ucp/api-schema-connect/ext/connector/v1alpha1/connector_pb.js";

import Server from "@ucp/express/index.js";
import currentSettings from "@ucp/express/settings.js";
import { safeFromJson } from "@ucp/express/utils.js";

import { init } from "@{{ cookiecutter.username }}/{{ cookiecutter.slug }}/index.js";

/**
 * This Connector Service _should_ satisfy the contracts outlined in the
 * Univeral Connector Protocol (UCP).
 *
 * @see UCP connector schema (`ext/connector/v1alpha1/connector`)
 */
describe("Test Contracts", () => {
  const { app, start } = new Server(currentSettings);
  const [version, connectorId] = ["v1alpha1", uuid.v4()]
  const router = `/api/connector/${version}/connectors/${connectorId}`

  let server: http.Server;

  beforeAll(async () => {
    expect(!app.locals.ready);
    init(app);
    server = start();
    expect(app.locals.ready);
  });

  afterAll(async () => server.close());

  test.each([
    {
      method: "ListContents",
      route: `${router}/contents:pull`,
      query: new URLSearchParams({
        seed_source_location: "file://path/to",
      }),
      schema: schemas.ListContentsResponseSchema,
    },
    {
      method: "ReadContent",
      route: `${router}/content-data:download`,
      query: new URLSearchParams({
        source_location: "file://path/to/source.txt",
      }),
      schema: schemas.ContentDataResponseSchema,
    },
    {
      method: "GetMetadata",
      route: `${router}/content/metadata`,
      query: new URLSearchParams({
        source_location: "file://path/to/source.txt",
      }),
      schema: schemas.GetMetadataResponseSchema,
    },
    {
      method: "GetContentPermissions",
      route: `${router}/content/read-permission`,
      query: new URLSearchParams({
        source_location: "file://path/to/source.txt",
      }),
      schema: schemas.getContentPermissionsResponseSchema,
    },
    {
      method: "GetPermissionGroups",
      route: `${router}/group-permissions`,
      query: new URLSearchParams(),
      schema: schemas.getPermissionGroupsResponseSchema,
    },
    {
      method: "GetPermissionGroupMembers",
      route: `${router}/group-permission/members`,
      query: new URLSearchParams({ group_id: "" }),
      schema: schemas.getPermissionGroupMembersResponseSchema,
    },
  ])("should implement $method", async ({ route, query, schema }) => {
    const response = await request(server)
      .get(`${route}?${query.toString()}`)
      .expect(200);
    ;

    expect(safeFromJson(schema, response.body));
  });
});
