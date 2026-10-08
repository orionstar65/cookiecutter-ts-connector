import express from "express";
import createError from "http-errors";
import { StatusCodes } from "http-status-codes";
import request from "supertest";
import pino from "pino";

import ErrorHandlerMiddleware from "@ucp/express/middleware/ErrorHandlerMiddleware.js";
import { REASON_CLIENT_DISCONNECT } from "@ucp/express/middleware/RequestAbortController.js";
import { ExpressSettings } from "@ucp/express/settings.js";
import { describe, expect, test } from "vitest";

// Minimal capturing logger to assert log level/shape without a real pino sink.
function captureLogger() {
  const calls: { level: string; obj: unknown; msg?: string }[] = [];
  const at = (level: string) => (obj: unknown, msg?: string) =>
    calls.push({ level, obj, msg });
  const logger = {
    info: at("info"),
    error: at("error"),
    debug: at("debug"),
    warn: at("warn"),
    fatal: at("fatal"),
    trace: at("trace"),
  };
  return { logger, calls };
}

// Mock Response capturing whether a body was written, with optional abort signal.
function mockRes(abortSignal?: { aborted: boolean; reason: unknown }) {
  return {
    headersSent: false,
    // A live, pre-headers response: writable and not yet ended. The
    // terminal guard reads these (`res.writableEnded || !res.writable`)
    // to detect a response that `pipeline` already tore down.
    writable: true,
    writableEnded: false,
    locals: abortSignal ? { abortSignal } : {},
    statusArg: undefined as number | undefined,
    jsonArg: undefined as unknown,
    status(code: number) {
      this.statusArg = code;
      return this;
    },
    json(b: unknown) {
      this.jsonArg = b;
      return this;
    },
  };
}

const settings: ExpressSettings = {
  name: "test-error-handler",
  env: "test",
  dev: true,
  root: new URL("http://localhost:9999"),
  log: { level: "fatal", src: false },
  server: {
    timeout: 120_000,
    requestTimeout: 60_000,
    keepAliveTimeout: 65_000,
    maxConnections: 1024,
  },
};

const logger = pino({ name: "test", level: "fatal" });

function createApp() {
  const app = express();
  app.use(express.json());
  return app;
}

describe("ErrorHandlerMiddleware", () => {
  test("catches sync throws without try/catch", async () => {
    const app = createApp();

    app.get("/sync-throw", (_req, _res) => {
      throw new Error("sync boom");
    });

    app.use(ErrorHandlerMiddleware(settings, logger));

    await request(app)
      .get("/sync-throw")
      .expect(StatusCodes.INTERNAL_SERVER_ERROR)
      .then((res) => {
        expect(res.body.message).toBe("Something Broke");
        expect(res.body.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
      });
  });

  test("catches async rejections without try/catch", async () => {
    const app = createApp();

    app.get("/async-throw", async (_req, _res) => {
      throw new Error("async boom");
    });

    app.use(ErrorHandlerMiddleware(settings, logger));

    await request(app)
      .get("/async-throw")
      .expect(StatusCodes.INTERNAL_SERVER_ERROR)
      .then((res) => {
        expect(res.body.message).toBe("Something Broke");
        expect(res.body.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
      });
  });

  test("handles HttpError with correct status code", async () => {
    const app = createApp();

    app.get("/http-error", async () => {
      throw createError(StatusCodes.NOT_FOUND, "not here");
    });

    app.use(ErrorHandlerMiddleware(settings, logger));

    await request(app)
      .get("/http-error")
      .expect(StatusCodes.NOT_FOUND)
      .then((res) => {
        expect(res.body.message).toBe("not here");
        expect(res.body.status).toBe(StatusCodes.NOT_FOUND);
      });
  });

  test("includes stack trace in dev mode", async () => {
    const app = createApp();

    app.get("/with-stack", async () => {
      throw new Error("stack trace test");
    });

    app.use(ErrorHandlerMiddleware({ ...settings, dev: true }, logger));

    await request(app)
      .get("/with-stack")
      .expect(StatusCodes.INTERNAL_SERVER_ERROR)
      .then((res) => {
        expect(res.body.stack).toBeDefined();
      });
  });

  test("omits stack trace in production mode", async () => {
    const app = createApp();

    app.get("/no-stack", async () => {
      throw new Error("no stack please");
    });

    app.use(ErrorHandlerMiddleware({ ...settings, dev: false }, logger));

    await request(app)
      .get("/no-stack")
      .expect(StatusCodes.INTERNAL_SERVER_ERROR)
      .then((res) => {
        expect(res.body.stack).toBeUndefined();
      });
  });

  test("HTTP response body.stack is unchanged regardless of the err-redaction flag", async () => {
    // The flag governs LOGGING shape, not the HTTP response shape. The
    // response is what callers (often other connector services) consume
    // and should not change behavior when ops flips the log flag.
    const prior = process.env.APP_LOG_REDACT_ERR_URLS;
    process.env.APP_LOG_REDACT_ERR_URLS = "true";
    try {
      const app = createApp();
      app.get("/leaky", async () => {
        const err = new Error(
          "upstream failed at https://tenant.sharepoint.com/x?token=abc",
        );
        throw err;
      });
      app.use(ErrorHandlerMiddleware({ ...settings, dev: true }, logger));

      await request(app)
        .get("/leaky")
        .expect(StatusCodes.INTERNAL_SERVER_ERROR)
        .then((res) => {
          // Response body still carries the raw stack — callers depend on
          // it. The log-side sanitization is asserted in logger.test.ts.
          expect(res.body.stack).toContain("tenant.sharepoint.com");
        });
    } finally {
      if (prior === undefined) {
        delete process.env.APP_LOG_REDACT_ERR_URLS;
      } else {
        process.env.APP_LOG_REDACT_ERR_URLS = prior;
      }
    }
  });

  test("delegates to next(err) instead of writing a body when headers already sent", () => {
    // Regression: a streaming download that errors/aborts after headers are
    // flushed must not have a 500 body written over it (ERR_HTTP_HEADERS_SENT
    // / write-after-end). The handler must delegate to Express's default.
    const handler = ErrorHandlerMiddleware(settings, logger);
    let statusCalled = false;
    let jsonCalled = false;
    let forwarded: unknown;
    const res = {
      headersSent: true,
      locals: {},
      status() {
        statusCalled = true;
        return this;
      },
      json() {
        jsonCalled = true;
        return this;
      },
    };
    const err = new Error("mid-stream boom");
    handler(
      err,
      { app: {} } as never,
      res as never,
      ((e: unknown) => {
        forwarded = e;
      }) as never,
    );

    expect(statusCalled).toBe(false);
    expect(jsonCalled).toBe(false);
    expect(forwarded).toBe(err);
  });

  test("client disconnect is logged at info (not error) and writes no body", () => {
    const { logger, calls } = captureLogger();
    const handler = ErrorHandlerMiddleware(settings, logger as never);
    const res = mockRes({ aborted: true, reason: REASON_CLIENT_DISCONNECT });
    const err = new Error("The operation was aborted");

    handler(err, { app: {} } as never, res as never, (() => {}) as never);

    // No body written to the dead socket.
    expect(res.statusArg).toBeUndefined();
    expect(res.jsonArg).toBeUndefined();
    // No error-level spam for a benign disconnect...
    expect(calls.some((c) => c.level === "error")).toBe(false);
    // ...but exactly one info line, carrying the error for context.
    const info = calls.filter((c) => c.level === "info");
    expect(info).toHaveLength(1);
    expect(info[0].obj).toMatchObject({ err });
  });

  test("a non-disconnect abort reason still produces a normal 500", () => {
    const { logger, calls } = captureLogger();
    const handler = ErrorHandlerMiddleware(settings, logger as never);
    // RequestAbortController.onError aborts with the raw socket error, which
    // isClientDisconnect must NOT match — a real failure must still surface.
    const res = mockRes({ aborted: true, reason: new Error("socket boom") });

    handler(
      new Error("boom"),
      { app: {} } as never,
      res as never,
      (() => undefined) as never,
    );

    expect(res.statusArg).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
    expect(calls.some((c) => c.level === "error")).toBe(true);
  });

  test("missing abortSignal falls through to normal error handling", () => {
    const { logger } = captureLogger();
    const handler = ErrorHandlerMiddleware(settings, logger as never);
    const res = mockRes(); // no abortSignal on locals

    handler(
      new Error("boom"),
      { app: {} } as never,
      res as never,
      (() => undefined) as never,
    );

    expect(res.statusArg).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
  });
});
