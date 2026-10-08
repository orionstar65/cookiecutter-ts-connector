import { describe, expect, vi, test, beforeEach } from "vitest";
import { EventEmitter } from "events";
import LoggingMiddleware from "@ucp/express/middleware/LoggingMiddleware.js";

function mockLogger() {
  const child = vi.fn().mockReturnThis();
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child,
  };
}

function mockRequest(url: string = "/test", headers: Record<string, string> = {}) {
  const hdrs: Record<string, string> = { ...headers };
  return {
    url,
    app: {},
    headers: hdrs,
    header(name: string) {
      return hdrs[name.toLowerCase()];
    },
  } as Parameters<ReturnType<typeof LoggingMiddleware>>[0];
}

function mockResponse() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    locals: {},
    statusCode: 200,
  }) as unknown as Parameters<ReturnType<typeof LoggingMiddleware>>[1];
}

describe("LoggingMiddleware", () => {
  let logger: ReturnType<typeof mockLogger>;
  let middleware: ReturnType<typeof LoggingMiddleware>;

  beforeEach(() => {
    logger = mockLogger();
    middleware = LoggingMiddleware(logger as any);
  });

  test("attaches child logger to response.locals", async () => {
    const req = mockRequest();
    const res = mockResponse();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(logger.child).toHaveBeenCalledWith({ scope: "response" });
    expect(res.locals.logger).toBeDefined();
    expect(next).toHaveBeenCalled();
  });

  test("generates x-request-id when not present", async () => {
    const req = mockRequest();
    const res = mockResponse();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(req.headers["x-request-id"]).toBeDefined();
    expect(req.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test("preserves existing x-request-id", async () => {
    const req = mockRequest("/test", { "x-request-id": "existing-id" });
    const res = mockResponse();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(req.headers["x-request-id"]).toBe("existing-id");
  });

  test("logs info on incoming non-healthcheck request", async () => {
    const req = mockRequest("/api/data");
    const res = mockResponse();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(logger.info).toHaveBeenCalledWith({ req }, "request received");
  });

  describe("healthcheck filtering", () => {
    const healthchecks = ["/alive", "/ready", "/metrics", "/stats", "/health"];

    test.each(healthchecks)("skips logging for %s", async (url) => {
      const req = mockRequest(url);
      const res = mockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      expect(logger.info).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });
  });

  describe("response log levels", () => {
    test("logs info on 2xx response", async () => {
      const req = mockRequest("/api/data");
      const res = mockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      res.statusCode = 200;
      res.emit("finish");

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ req, res }),
        "responded",
      );
    });

    test("logs info on 3xx response", async () => {
      const req = mockRequest("/api/data");
      const res = mockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      res.statusCode = 301;
      res.emit("finish");

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ req, res }),
        "responded",
      );
    });

    test("logs warn on 4xx response", async () => {
      const req = mockRequest("/api/data");
      const res = mockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      res.statusCode = 404;
      res.emit("finish");

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ req, res }),
        "responded",
      );
    });

    test("logs error on 5xx response", async () => {
      const req = mockRequest("/api/data");
      const res = mockResponse();
      const next = vi.fn();

      await middleware(req, res, next);

      res.statusCode = 500;
      res.emit("finish");

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ req, res }),
        "responded",
      );
    });
  });
});
