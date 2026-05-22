import * as uuid from "uuid";
import http from "http";
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";

import Server from "@ucp/express/index.js";
import currentSettings from "@ucp/express/settings.js";
import { init } from "@{{ cookiecutter.username }}/{{ cookiecutter.slug }}/index.js";

/**
 * All `Entries` should be `Listable`, meaning that calls to `ListContents`
 * _should_ succeed and return a page of data.
 *
 * The purpose of this test is to test all `Entry` implementors for
 * listability against the Connector.
 *
 *   - `FileEntries` _should_ return themselves.
 *   - `DirectoryEntries` _should_ return a page of entries from its
 *       descendents (if any).
 *
 */
describe("Test DirectoryEntries", () => {
  let server: http.Server;
  const { app, start } = new Server(currentSettings);
  const [version, connectorId] = ["v1alpha1", uuid.v4()]
  const router = `/api/connector/${version}/connectors/${connectorId}`
  const pageSize = 2;

  beforeAll(async () => {
    expect(!app.locals.ready);
    init(app);
    server = start();
    expect(app.locals.ready);
  });

  afterAll(async () => server.close());

  test.each([
    {
      case: "DirectoryEntry",
      seedSourceLocation: "file://path/to",
      count: pageSize,
    },
    {
      case: "FileEntry",
      seedSourceLocation: "file://path/to/source.txt",
      count: 1,
    },
  ])("$case should be listable.", async ({ seedSourceLocation, count }) => {
    const query = new URLSearchParams({ seedSourceLocation });
    const response = await request(server)
      .get(`${router}/contents:pull?${query.toString()}`)
      .expect(200);
    ;

    expect(response.body.items.length).toBeLessThanOrEqual(count);
  });
});
