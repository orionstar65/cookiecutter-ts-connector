import * as http from "http";

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, jest, test } from "@jest/globals";

import Server from "@ucp/express/index.js";
import currentSettings from "@ucp/express/settings.js";
import { init } from "@{{ cookiecutter.username }}/{{ cookiecutter.slug }}/index.js";


jest.setTimeout(10_000);
describe("Test crawl", () => {
  const baseURL = "https://cs2a25b778db53bx4287xa8b.blob.core.windows.net";
  const router = "/api/connector/v1alpha1/connectors/azs"

  let server: http.Server;
  const { app, start } = new Server(currentSettings);

  beforeAll(async () => {
    expect(!app.locals.ready);
    init(app);
    server = start();
    expect(app.locals.ready);
  });

  afterAll(async () => server.close());

  test.each([
    {
      case: "Azure Container",
      path: `${baseURL}/connectors`,
    },
    {
      case: "Azure Prefix",
      path: `${baseURL}/connectors/test data/`,
    },
    {
      case: "Azure Blob",
      path: `${baseURL}/connectors/test data/CDOC-111sdoc20.htm`,
    },
    {
      case: "Azure Blob",
      path: `${baseURL}/connectors/test data/subfolder/hello.txt`,
    },
  ])("should support $case", async ({ path }) => {
    // Initialize the crawl
    const page_size = 2;
    let page_token: string;

    // We should ALWAYS get at least 1 page of data on this test set.
    let response = await request(server)
      .get(`${router}/contents:pull`)
      .query({ seed_source_location: path })
      .query({ page_size })
    ;

    let { items } = response.body;
    page_token = response.body.next_page_token;

    // ! TEST: Length <= page_size!
    expect(response.statusCode).toBe(200);
    expect(response.body.items.length).toBeLessThanOrEqual(page_size);

    // ! TEST: Every blob returns its metadata!
    for (const item of items) {
      console.log(item);
      await request(server)
        .get(`${router}/content/metadata`)
        .query({ source_location: item.data.sourceLocation })
        .expect(200);
    }

    // As long as there is a next page...
    while (page_token) {
      // REPEAT
      response = await request(server)
        .get(`${router}/contents:pull`)
        .query({ seed_source_location: path })
        .query({ page_size, page_token })
      ;

      page_token = response.body.next_page_token;
      items = response.body.items;

      // ! TEST: Length <= page_size!
      expect(response.statusCode).toBe(200);
      expect(response.body.items.length).toBeLessThanOrEqual(page_size);

      // ! TEST: Every blob returns metadata!
      for (const item of items) {
        console.log(item);
        await request(server)
          .get(`${router}/content/metadata`)
          .query({ source_location: item.data.sourceLocation })
          .expect(200);
      }
    }
  });
});
