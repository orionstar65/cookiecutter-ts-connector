import { Environment, getCurrentSettings } from "@ucp/express/settings.js";
import { beforeEach, describe, expect, test } from "vitest";

function reset() {
  process.env.NODE_ENV = "testing";
  process.env.BITBUCKET_REPO = 'ucp-express';
  process.env.APP_LOG_LEVEL = 'debug';
  process.env.APP_REST_LISTEN_PORT = '8081';
}

describe("Test ExpressSettings", () => {
  beforeEach(reset);

  describe("should get service root from NODE_ENV", () => {
    test.each([
      {
        env: Environment.Local,
        protocol: "http:",
        host: "localhost",
        port: 8081,
      },
      {
        env: Environment.Development,
        protocol: "https:",
        host: "ucp-express.ucp.svc.cluster.local",
        port: 8081,
      },
      {
        env: Environment.Mainline,
        protocol: "https:",
        host: "ucp-express.ucp.svc.cluster.local",
        port: 8081,
      },
      {
        env: Environment.Production,
        protocol: "https:",
        host: "ucp-express.ucp.svc.cluster.local",
        port: 8081,
      },
      {
        env: Environment.Sandbox,
        protocol: "https:",
        host: "ucp-express.ucp.svc.cluster.local",
        port: 8081,
      },
    ])("$env", async ({env, protocol, host, port}) => {
      process.env.NODE_ENV = env;

      const settings = getCurrentSettings();
      expect(settings.root.hostname).toBe(host);
      expect(parseInt(settings.root.port)).toBe(port);
      expect(settings.root.protocol).toBe(protocol);
    });
  });

  describe("should support valid log levels", () => {
    const levels = ["trace", "debug", "info", "warn", "error", "fatal"].map(
      (level) => ({ level }),
    );

    test.each(levels)("supports $level", async ({level}) => {
      process.env.APP_LOG_LEVEL = level;
      const settings = getCurrentSettings();
      expect(settings.log.level).toBe(level)
    });

    test("overrides bogus level", async () => {
      process.env.APP_LOG_LEVEL = "bogus";
      const settings = getCurrentSettings();
      expect(settings.log.level).toBe("info")
    });
  });
});
