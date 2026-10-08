import * as http from "http";
import { URL } from "url";

import Server from "@ucp/express/index.js";
import { ExpressSettings } from "@ucp/express/settings.js";

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const settings: ExpressSettings = {
  name: "test-ucp-express",
  env: "test",
  dev: true,
  root: new URL("http://localhost:8081"),
  log: { level: "debug", src: true },
  server: { timeout: 120_000, requestTimeout: 60_000, keepAliveTimeout: 65_000, maxConnections: 1024 },
}

describe("Test Server start", () => {
  let server: http.Server;
  const { app, start } = new Server(settings);

  beforeAll(async () => {
    expect(!app.locals.ready);
    server = start();
    expect(app.locals.ready);
  });

  afterAll(async () => await server.close());

  describe("should have correct app.locals", () => {
    test("has an id", () => {
      expect(app.locals.id).toBeDefined();
    });
    test("has the correct name", () => {
      expect(app.locals.name).toBe(settings.name);
    });
    test("has the correct instance", () => {
      expect(app.locals.instance).toBe(settings.name + "." + app.locals.id);
    });
    test("has a startTime before now", () => {
      expect(app.locals.startTime).toBeLessThan(Date.now());
    });
  });

  describe("should have default routes", () => {
    test("Home should respond", async () => {
      await request(app).get('/').expect(200).then(
        response => {
          expect(response.body).toHaveProperty('code');
          expect(response.body.code).toBe(response.statusCode);
          expect(response.body).toHaveProperty('time');
          expect(response.body.time).toBeGreaterThan(app.locals.startTime);
        }
      );
    });

    test("Alive should respond", async () => {
      await request(app).get('/alive').expect(200).then(
        response => {
          expect(response.body).toHaveProperty('code');
          expect(response.body.code).toBe(response.statusCode);
          expect(response.body).toHaveProperty('time');
          expect(response.body.time).toBeGreaterThan(app.locals.startTime);
        }
      );
    });

    test("Ready should respond", async () => {
      await request(app).get('/ready').expect(200).then(
        response => {
          expect(response.body).toHaveProperty('code');
          expect(response.body.code).toBe(response.statusCode);
          expect(response.body).toHaveProperty('time');
          expect(response.body.time).toBeGreaterThan(app.locals.startTime);
        }
      );
    });

    test("Stats should respond", async () => {
      await request(app).get('/metrics').expect(200);
    });
  });
});
