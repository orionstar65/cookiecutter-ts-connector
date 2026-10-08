import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import pino from "pino";

import logger, {
  requestSerializer,
  responseSerializer,
  sanitizeStackForLog,
  _resetFlagDeviationWarnedForTests,
} from "@ucp/express/logger.js";

describe("logger", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  function lastLogEntry(): Record<string, any> {
    const calls = stdoutSpy.mock.calls;
    const lastCall = calls[calls.length - 1][0] as string;
    return JSON.parse(lastCall);
  }

  test("returns a logger with the given name", () => {
    const log = logger("test-logger", "info", false, "test");
    expect(log).toBeDefined();
    log.info("name check");
    expect(lastLogEntry().name).toBe("test-logger");
  });

  test("respects the given log level", () => {
    const log = logger("test-logger", "debug", false, "test");
    expect(log.level).toBe("debug");
  });

  test("sets env field", () => {
    const log = logger("test-logger", "info", false, "production");
    log.info("env check");
    expect(lastLogEntry().env).toBe("production");
  });

  test("req serializer returns null for falsy input", () => {
    expect(requestSerializer(null as any)).toBeNull();
  });

  test("res serializer returns null for falsy input", () => {
    expect(responseSerializer(null as any)).toBeNull();
  });
});

// ── Characterization Tests ──────────────────────────────────────────────────

describe("StackDriver output format", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  function lastLogEntry(): Record<string, any> {
    const calls = stdoutSpy.mock.calls;
    const lastCall = calls[calls.length - 1][0] as string;
    return JSON.parse(lastCall);
  }

  test("info emits severity INFO with timestamp and M fields", () => {
    const log = logger("sd-test", "trace", false, "test");
    log.info("hello world");

    const entry = lastLogEntry();
    expect(entry.severity).toBe("INFO");
    expect(entry.timestamp).toBe(entry.time);
    expect(entry.M).toBe("hello world");
    expect(entry.msg).toBe("hello world");
  });

  test("warn emits severity WARNING (not WARN)", () => {
    const log = logger("sd-test", "trace", false, "test");
    log.warn("be careful");

    const entry = lastLogEntry();
    expect(entry.severity).toBe("WARNING");
    expect(entry.M).toBe("be careful");
  });

  test("debug emits severity DEBUG", () => {
    const log = logger("sd-test", "trace", false, "test");
    log.debug("debug msg");

    const entry = lastLogEntry();
    expect(entry.severity).toBe("DEBUG");
  });

  test("error emits severity ERROR", () => {
    const log = logger("sd-test", "trace", false, "test");
    log.error("something broke");

    const entry = lastLogEntry();
    expect(entry.severity).toBe("ERROR");
  });

  test("fatal emits severity FATAL", () => {
    const log = logger("sd-test", "trace", false, "test");
    log.fatal("critical failure");

    const entry = lastLogEntry();
    expect(entry.severity).toBe("FATAL");
  });

  test("structured logging preserves extra fields alongside StackDriver fields", () => {
    const log = logger("sd-test", "trace", false, "test");
    log.info({ key: "val" }, "structured msg");

    const entry = lastLogEntry();
    expect(entry.severity).toBe("INFO");
    expect(entry.timestamp).toBeDefined();
    expect(entry.M).toBe("structured msg");
    expect(entry.key).toBe("val");
  });
});

describe("serializer output shapes", () => {
  test("req serializer returns expected shape", () => {
    const mockReq = {
      headers: {
        "x-request-id": "req-123",
        "content-type": "application/json",
      },
      method: "GET",
      url: "/test",
      hostname: "localhost",
      query: { q: "search" },
      httpVersion: "1.1",
      ip: "127.0.0.1",
    };

    const result = requestSerializer(mockReq as any);
    expect(result).toEqual({
      id: "req-123",
      method: "GET",
      url: "/test",
      hostname: "localhost",
      query: { q: expect.stringMatching(/^\[Redacted\]#sha256=[a-f0-9]{12}$/) },
      headers: mockReq.headers,
      httpVersion: "1.1",
      clientIp: "127.0.0.1",
    });
  });

  test("req serializer redacts query values from url and query fields", () => {
    const sensitiveSource =
      "https://tenant.sharepoint.com/sites/Team/Documents/private.docx?download=1";
    const mockReq = {
      headers: {
        "x-request-id": "req-123",
        host: "localhost",
      },
      method: "GET",
      url:
        "/api/content-data:download?sourceLocation=" +
        encodeURIComponent(sensitiveSource) +
        "&pageSize=2",
      hostname: "localhost",
      query: {
        sourceLocation: sensitiveSource,
        pageSize: "2",
      },
      httpVersion: "1.1",
      ip: "127.0.0.1",
    };

    const result = requestSerializer(mockReq as any);
    const serialized = JSON.stringify(result);

    expect(result?.url).toContain("/api/content-data:download?");
    expect(result?.url).toContain("sourceLocation=");
    expect(result?.url).toContain("pageSize=");
    expect(result?.query).toHaveProperty("sourceLocation");
    expect(result?.query).toHaveProperty("pageSize");
    expect(serialized).toContain("sha256=");
    // The unified format preserves origin for URL-shaped values so the
    // tenant origin (which service / which deployment) stays diagnostic
    // while the document path is hashed.
    expect(serialized).toContain("https://tenant.sharepoint.com/...#sha256=");
    expect(serialized).not.toContain("private.docx");
    expect(serialized).not.toContain("download=1");
    expect(serialized).not.toContain("pageSize=2");
  });

  test("redaction token shape matches between url and query fields", () => {
    const mockReq = {
      headers: { "x-request-id": "req-123" },
      method: "GET",
      url: "/api/contents:pull?cursor=abc&pageSize=10",
      hostname: "localhost",
      query: { cursor: "abc", pageSize: "10" },
      httpVersion: "1.1",
      ip: "127.0.0.1",
    };

    const result = requestSerializer(mockReq as any);

    expect(result?.url).toMatch(
      /^\/api\/contents:pull\?cursor=\[Redacted\]#sha256=[a-f0-9]{12}&pageSize=\[Redacted\]#sha256=[a-f0-9]{12}$/,
    );
    expect((result?.query as any).cursor).toMatch(
      /^\[Redacted\]#sha256=[a-f0-9]{12}$/,
    );
    expect((result?.query as any).pageSize).toMatch(
      /^\[Redacted\]#sha256=[a-f0-9]{12}$/,
    );
  });

  test("sanitizeRequestUrl tolerates undefined, null, and malformed urls", () => {
    const cases = [
      { url: undefined, expectUrl: "" },
      { url: null, expectUrl: "" },
      { url: "", expectUrl: "" },
      { url: "*", expectUrl: "*" },
    ];

    for (const { url, expectUrl } of cases) {
      const result = requestSerializer({
        headers: {},
        method: "OPTIONS",
        url,
        hostname: "localhost",
        query: {},
        httpVersion: "1.1",
        ip: "127.0.0.1",
      } as any);
      expect(result?.url).toBe(expectUrl);
    }
  });

  test("sanitizeRequestUrl yields a hashed fallback for unparseable urls", () => {
    const result = requestSerializer({
      headers: {},
      method: "GET",
      url: "http://[::1",
      hostname: "localhost",
      query: {},
      httpVersion: "1.1",
      ip: "127.0.0.1",
    } as any);

    expect(typeof result?.url).toBe("string");
    expect(result?.url).toMatch(
      /^\[unparseable-url\]#sha256=[a-f0-9]{12}$/,
    );
  });

  test("redactQuery treats Date and Buffer as opaque scalars", () => {
    const date = new Date("2026-05-12T00:00:00Z");
    const buf = Buffer.from("secret");
    const result = requestSerializer({
      headers: {},
      method: "GET",
      url: "/test",
      hostname: "localhost",
      query: { when: date, payload: buf },
      httpVersion: "1.1",
      ip: "127.0.0.1",
    } as any);

    expect((result?.query as any).when).toMatch(
      /^\[Redacted\]#sha256=[a-f0-9]{12}$/,
    );
    expect((result?.query as any).payload).toMatch(
      /^\[Redacted\]#sha256=[a-f0-9]{12}$/,
    );
  });

  test("APP_LOG_REDACT_QUERY=false disables redaction", () => {
    const prior = process.env.APP_LOG_REDACT_QUERY;
    process.env.APP_LOG_REDACT_QUERY = "false";
    try {
      const mockReq = {
        headers: {},
        method: "GET",
        url: "/api/test?q=hello",
        hostname: "localhost",
        query: { q: "hello" },
        httpVersion: "1.1",
        ip: "127.0.0.1",
      };
      const result = requestSerializer(mockReq as any);
      expect(result?.url).toBe("/api/test?q=hello");
      expect(result?.query).toStrictEqual({ q: "hello" });
    } finally {
      if (prior === undefined) {
        delete process.env.APP_LOG_REDACT_QUERY;
      } else {
        process.env.APP_LOG_REDACT_QUERY = prior;
      }
    }
  });

  test("APP_LOG_REDACT_QUERY=0 also disables redaction", () => {
    const prior = process.env.APP_LOG_REDACT_QUERY;
    process.env.APP_LOG_REDACT_QUERY = "0";
    try {
      const result = requestSerializer({
        headers: {},
        method: "GET",
        url: "/api/test?q=hello",
        hostname: "localhost",
        query: { q: "hello" },
        httpVersion: "1.1",
        ip: "127.0.0.1",
      } as any);
      expect(result?.url).toBe("/api/test?q=hello");
      expect(result?.query).toStrictEqual({ q: "hello" });
    } finally {
      if (prior === undefined) {
        delete process.env.APP_LOG_REDACT_QUERY;
      } else {
        process.env.APP_LOG_REDACT_QUERY = prior;
      }
    }
  });

  test("res serializer returns expected shape", () => {
    const mockRes = {
      statusCode: 200,
      get: (name: string) => {
        const headers: Record<string, string> = {
          "content-type": "application/json",
          "content-length": "42",
        };
        return headers[name];
      },
      getHeaders: () => ({
        "content-type": "application/json",
        "content-length": "42",
      }),
    };

    const result = responseSerializer(mockRes as any);
    expect(result).toStrictEqual({
      statusCode: 200,
      contentType: "application/json",
      size: "42",
      headers: { "content-type": "application/json", "content-length": "42" },
    });
  });

  test("err serializer returns object with message, name, stack", () => {
    const err = new Error("test error");
    const result = pino.stdSerializers.err(err);
    expect(result).toHaveProperty("message", "test error");
    expect(result).toHaveProperty("type", "Error");
    expect(result).toHaveProperty("stack");
  });

  test("req serializer returns null for undefined input", () => {
    expect(requestSerializer(undefined)).toBeNull();
  });

  test("res serializer returns null for undefined input", () => {
    expect(responseSerializer(undefined)).toBeNull();
  });
});

describe("header redaction", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  function lastLogEntry(): Record<string, any> {
    const calls = stdoutSpy.mock.calls;
    const lastCall = calls[calls.length - 1][0] as string;
    return JSON.parse(lastCall);
  }

  test("redacts authorization header from req", () => {
    const log = logger("redact-test", "trace", false, "test");
    log.info(
      {
        req: {
          headers: {
            authorization: "Bearer secret-token",
            "content-type": "application/json",
          },
          method: "GET",
          url: "/test",
          hostname: "localhost",
          query: {},
          httpVersion: "1.1",
          ip: "127.0.0.1",
        },
      },
      "request with auth",
    );

    const entry = lastLogEntry();
    expect(entry.req.headers.authorization).toBe("[Redacted]");
    expect(entry.req.headers["content-type"]).toBe("application/json");
  });

  test("redacts cookie header from req", () => {
    const log = logger("redact-test", "trace", false, "test");
    log.info(
      {
        req: {
          headers: { cookie: "session=abc123", host: "localhost" },
          method: "GET",
          url: "/test",
          hostname: "localhost",
          query: {},
          httpVersion: "1.1",
          ip: "127.0.0.1",
        },
      },
      "request with cookie",
    );

    const entry = lastLogEntry();
    expect(entry.req.headers.cookie).toBe("[Redacted]");
    expect(entry.req.headers.host).toBe("localhost");
  });

  test("redacts proxy-authorization header from req", () => {
    const log = logger("redact-test", "trace", false, "test");
    log.info(
      {
        req: {
          headers: { "proxy-authorization": "Basic creds" },
          method: "GET",
          url: "/test",
          hostname: "localhost",
          query: {},
          httpVersion: "1.1",
          ip: "127.0.0.1",
        },
      },
      "request with proxy auth",
    );

    const entry = lastLogEntry();
    expect(entry.req.headers["proxy-authorization"]).toBe("[Redacted]");
  });

  test("redacts x-api-key header from req", () => {
    const log = logger("redact-test", "trace", false, "test");
    log.info(
      {
        req: {
          headers: { "x-api-key": "sk-secret" },
          method: "GET",
          url: "/test",
          hostname: "localhost",
          query: {},
          httpVersion: "1.1",
          ip: "127.0.0.1",
        },
      },
      "request with api key",
    );

    const entry = lastLogEntry();
    expect(entry.req.headers["x-api-key"]).toBe("[Redacted]");
  });

  test("redacts set-cookie header from res", () => {
    const log = logger("redact-test", "trace", false, "test");
    const mockRes = {
      statusCode: 200,
      get: (name: string) => {
        const h: Record<string, string> = { "content-type": "text/html" };
        return h[name];
      },
      getHeaders: () => ({
        "content-type": "text/html",
        "set-cookie": "session=abc; HttpOnly",
      }),
    };
    log.info({ res: mockRes }, "response with set-cookie");

    const entry = lastLogEntry();
    expect(entry.res.headers["set-cookie"]).toBe("[Redacted]");
  });

  test("preserves non-sensitive headers", () => {
    const log = logger("redact-test", "trace", false, "test");
    log.info(
      {
        req: {
          headers: {
            "content-type": "application/json",
            accept: "text/html",
            "x-request-id": "abc-123",
          },
          method: "GET",
          url: "/test",
          hostname: "localhost",
          query: {},
          httpVersion: "1.1",
          ip: "127.0.0.1",
        },
      },
      "request with safe headers",
    );

    const entry = lastLogEntry();
    expect(entry.req.headers["content-type"]).toBe("application/json");
    expect(entry.req.headers.accept).toBe("text/html");
    expect(entry.req.headers["x-request-id"]).toBe("abc-123");
  });
});

describe("logger API surface", () => {
  test("factory returns object with all expected log methods", () => {
    const log = logger("api-test", "info", false, "test");
    expect(typeof log.info).toBe("function");
    expect(typeof log.error).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.debug).toBe("function");
    expect(typeof log.fatal).toBe("function");
    expect(typeof log.trace).toBe("function");
    expect(typeof log.child).toBe("function");
  });

  test("child returns logger with same log methods", () => {
    const log = logger("api-test", "info", false, "test");
    const child = log.child({ scope: "test" });
    expect(typeof child.info).toBe("function");
    expect(typeof child.error).toBe("function");
    expect(typeof child.warn).toBe("function");
    expect(typeof child.debug).toBe("function");
    expect(typeof child.fatal).toBe("function");
    expect(typeof child.trace).toBe("function");
    expect(typeof child.child).toBe("function");
  });
});

// ── Test-gap closures from adversarial review ──────────────────────────────
//
// These tests close coverage holes that existed before the redaction work
// was added — they pin behavior that the existing tests left implicit so
// future refactors of the serializer pipeline cannot silently regress.

describe("request serializer end-to-end through pino", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  function lastLogEntry(): Record<string, any> {
    const calls = stdoutSpy.mock.calls;
    const lastCall = calls[calls.length - 1][0] as string;
    return JSON.parse(lastCall);
  }

  test("url and query redaction flow through the live pino instance", () => {
    const log = logger("e2e-test", "trace", false, "test");
    log.info(
      {
        req: {
          headers: { "x-request-id": "req-e2e" },
          method: "GET",
          url: "/api/contents:pull?cursor=abc&pageSize=10",
          hostname: "localhost",
          query: { cursor: "abc", pageSize: "10" },
          httpVersion: "1.1",
          ip: "127.0.0.1",
        },
      },
      "request",
    );

    const entry = lastLogEntry();
    expect(entry.req.url).toMatch(
      /^\/api\/contents:pull\?cursor=\[Redacted\]#sha256=[a-f0-9]{12}&pageSize=\[Redacted\]#sha256=[a-f0-9]{12}$/,
    );
    expect(entry.req.query.cursor).toMatch(
      /^\[Redacted\]#sha256=[a-f0-9]{12}$/,
    );
    expect(entry.req.query.pageSize).toMatch(
      /^\[Redacted\]#sha256=[a-f0-9]{12}$/,
    );
  });

  test("error logs intentionally retain raw URLs attached to the error for triage", () => {
    const log = logger("e2e-test", "trace", false, "test");
    // Pino's stdSerializers.err walks own-enumerable properties of the
    // error and emits them verbatim — this is the shape produced by undici,
    // axios, and Graph SDK wrappers that decorate errors with `config` or
    // `response` payloads.
    const err = new Error("upstream failure") as Error & {
      config?: { url?: string };
    };
    err.config = {
      url: "https://tenant.sharepoint.com/sites/Team/Documents/private.docx?download=1",
    };

    log.error({ err }, "upstream failed");

    const entry = lastLogEntry();
    // This is the intentional asymmetry documented in ErrorHandlerMiddleware:
    // the access log path sanitizes req.url, the error path keeps full URLs
    // available for triage. Flag this test if compliance reaches a different
    // conclusion and the err serializer needs to start sanitizing too.
    const serialized = JSON.stringify(entry);
    expect(serialized).toContain("tenant.sharepoint.com");
    expect(serialized).toContain("private.docx");
  });
});

describe("request serializer query-shape coverage", () => {
  test("repeated query keys preserve array structure in both url and query", () => {
    const result = requestSerializer({
      headers: {},
      method: "GET",
      url: "/api/test?tag=red&tag=blue",
      hostname: "localhost",
      // Express qs default produces an array for repeated keys.
      query: { tag: ["red", "blue"] },
      httpVersion: "1.1",
      ip: "127.0.0.1",
    } as any);

    expect(Array.isArray((result?.query as any).tag)).toBe(true);
    expect((result?.query as any).tag).toHaveLength(2);
    (result?.query as any).tag.forEach((v: string) =>
      expect(v).toMatch(/^\[Redacted\]#sha256=[a-f0-9]{12}$/),
    );
    expect(result?.url).toMatch(
      /^\/api\/test\?tag=\[Redacted\]#sha256=[a-f0-9]{12}&tag=\[Redacted\]#sha256=[a-f0-9]{12}$/,
    );
  });

  test("nested query objects are redacted recursively", () => {
    const result = requestSerializer({
      headers: {},
      method: "GET",
      url: "/api/test?filter[name]=alice&filter[age]=30",
      hostname: "localhost",
      query: { filter: { name: "alice", age: "30" } },
      httpVersion: "1.1",
      ip: "127.0.0.1",
    } as any);

    expect((result?.query as any).filter.name).toMatch(
      /^\[Redacted\]#sha256=[a-f0-9]{12}$/,
    );
    expect((result?.query as any).filter.age).toMatch(
      /^\[Redacted\]#sha256=[a-f0-9]{12}$/,
    );
  });

  test("arrays of objects in query are redacted recursively", () => {
    const result = requestSerializer({
      headers: {},
      method: "GET",
      url: "/api/test",
      hostname: "localhost",
      query: { items: [{ id: "1" }, { id: "2" }] },
      httpVersion: "1.1",
      ip: "127.0.0.1",
    } as any);

    expect(Array.isArray((result?.query as any).items)).toBe(true);
    (result?.query as any).items.forEach((item: { id: string }) =>
      expect(item.id).toMatch(/^\[Redacted\]#sha256=[a-f0-9]{12}$/),
    );
  });

  test("null query values pass through without being hashed", () => {
    const result = requestSerializer({
      headers: {},
      method: "GET",
      url: "/api/test",
      hostname: "localhost",
      query: { flag: null },
      httpVersion: "1.1",
      ip: "127.0.0.1",
    } as any);

    expect((result?.query as any).flag).toBeNull();
  });
});

describe("request serializer field-shape preservation", () => {
  test("redaction does not drop method, hostname, headers, httpVersion, or clientIp", () => {
    const headers = {
      "x-request-id": "req-shape",
      "content-type": "application/json",
    };
    const result = requestSerializer({
      headers,
      method: "POST",
      url: "/api/test?x=1",
      hostname: "host.example",
      query: { x: "1" },
      httpVersion: "2.0",
      ip: "10.0.0.1",
    } as any);

    expect(result?.id).toBe("req-shape");
    expect(result?.method).toBe("POST");
    expect(result?.hostname).toBe("host.example");
    expect(result?.headers).toBe(headers);
    expect(result?.httpVersion).toBe("2.0");
    expect(result?.clientIp).toBe("10.0.0.1");
  });

  test("urls with no query string are returned unchanged", () => {
    const result = requestSerializer({
      headers: {},
      method: "GET",
      url: "/api/health",
      hostname: "localhost",
      query: {},
      httpVersion: "1.1",
      ip: "127.0.0.1",
    } as any);

    expect(result?.url).toBe("/api/health");
  });
});

describe("unified hash format — URL-shaped values preserve origin", () => {
  test("URL-shaped query values get origin preserved with path hashed", () => {
    const url =
      "https://tenant.sharepoint.com/sites/Team/Documents/private.docx?download=1";
    const result = requestSerializer({
      headers: {},
      method: "GET",
      url: "/api/test?sourceLocation=" + encodeURIComponent(url),
      hostname: "localhost",
      query: { sourceLocation: url },
      httpVersion: "1.1",
      ip: "127.0.0.1",
    } as any);

    expect((result?.query as any).sourceLocation).toMatch(
      /^https:\/\/tenant\.sharepoint\.com\/\.\.\.#sha256=[a-f0-9]{12}$/,
    );
    expect(result?.url).toContain("https://tenant.sharepoint.com/...#sha256=");
    expect(JSON.stringify(result)).not.toContain("private.docx");
  });

  test("non-URL query values use the opaque token form", () => {
    const result = requestSerializer({
      headers: {},
      method: "GET",
      url: "/api/test?pageSize=10",
      hostname: "localhost",
      query: { pageSize: "10" },
      httpVersion: "1.1",
      ip: "127.0.0.1",
    } as any);
    expect((result?.query as any).pageSize).toMatch(
      /^\[Redacted\]#sha256=[a-f0-9]{12}$/,
    );
  });
});

describe("error-log URL redaction flag (APP_LOG_REDACT_ERR_URLS)", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    _resetFlagDeviationWarnedForTests();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  function lastLogEntry(): Record<string, any> {
    const calls = stdoutSpy.mock.calls;
    const lastCall = calls[calls.length - 1][0] as string;
    return JSON.parse(lastCall);
  }

  function withErrRedaction<T>(value: string, fn: () => T): T {
    const prior = process.env.APP_LOG_REDACT_ERR_URLS;
    process.env.APP_LOG_REDACT_ERR_URLS = value;
    try {
      return fn();
    } finally {
      if (prior === undefined) {
        delete process.env.APP_LOG_REDACT_ERR_URLS;
      } else {
        process.env.APP_LOG_REDACT_ERR_URLS = prior;
      }
    }
  }

  test("flag=true hashes URLs in err.config and err.stack", () => {
    withErrRedaction("true", () => {
      const log = logger("err-redact-test", "trace", false, "test");
      const err = new Error("upstream failure") as Error & {
        config?: { url?: string };
      };
      err.config = {
        url: "https://tenant.sharepoint.com/sites/Team/Documents/private.docx?download=1",
      };

      log.error({ err }, "upstream failed");

      const serialized = JSON.stringify(lastLogEntry());
      expect(serialized).not.toContain("private.docx");
      expect(serialized).not.toContain("download=1");
      // Origin is preserved by design — operators still see which tenant
      // failed.
      expect(serialized).toContain("https://tenant.sharepoint.com/...#sha256=");
    });
  });

  test("flag=true preserves file:// URIs inside stack frames", () => {
    withErrRedaction("true", () => {
      const log = logger("err-redact-test", "trace", false, "test");
      const err = new Error("boom");
      // V8 stack frames embed `file:///` paths; we keep them so triage
      // can still walk back to source lines.
      log.error({ err }, "boom");

      const entry = lastLogEntry();
      expect(entry.err.stack).toContain("file://");
    });
  });

  test("flag default leaves err untouched", () => {
    const log = logger("err-redact-test", "trace", false, "test");
    const err = new Error("upstream failure") as Error & {
      config?: { url?: string };
    };
    err.config = {
      url: "https://tenant.sharepoint.com/x?token=secret",
    };

    log.error({ err }, "upstream failed");

    const serialized = JSON.stringify(lastLogEntry());
    expect(serialized).toContain("tenant.sharepoint.com");
    expect(serialized).toContain("token=secret");
  });

  test("sanitizeStackForLog returns input unchanged when flag is off", () => {
    const stack =
      "Error: boom\n    at fn (https://tenant.sharepoint.com/x?token=t)";
    expect(sanitizeStackForLog(stack)).toBe(stack);
    expect(sanitizeStackForLog(undefined)).toBeUndefined();
  });

  test("sanitizeStackForLog scrubs http(s) urls when flag is on", () => {
    withErrRedaction("true", () => {
      const stack =
        "Error: boom\n    at fn (https://tenant.sharepoint.com/x?token=t)";
      const result = sanitizeStackForLog(stack);
      expect(result).toContain("https://tenant.sharepoint.com/...#sha256=");
      expect(result).not.toContain("token=t");
    });
  });
});

describe("flag governance warn-on-construction", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    _resetFlagDeviationWarnedForTests();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  function warnEntries(): Record<string, any>[] {
    return stdoutSpy.mock.calls
      .map((c) => {
        try {
          return JSON.parse(c[0] as string);
        } catch {
          return null;
        }
      })
      .filter((e): e is Record<string, any> => e !== null && e.level === 40);
  }

  test("warns once when APP_LOG_REDACT_QUERY disables redaction", () => {
    const prior = process.env.APP_LOG_REDACT_QUERY;
    process.env.APP_LOG_REDACT_QUERY = "false";
    try {
      logger("warn-test", "trace", false, "test");
      const warns = warnEntries().filter((e) =>
        String(e.msg).includes("query redaction is DISABLED"),
      );
      expect(warns).toHaveLength(1);
      expect(warns[0].flag).toBe("APP_LOG_REDACT_QUERY");
    } finally {
      if (prior === undefined) {
        delete process.env.APP_LOG_REDACT_QUERY;
      } else {
        process.env.APP_LOG_REDACT_QUERY = prior;
      }
    }
  });

  test("warns once when APP_LOG_REDACT_ERR_URLS enables err redaction", () => {
    const prior = process.env.APP_LOG_REDACT_ERR_URLS;
    process.env.APP_LOG_REDACT_ERR_URLS = "true";
    try {
      logger("warn-test", "trace", false, "test");
      const warns = warnEntries().filter((e) =>
        String(e.msg).includes("error-log URL redaction is ENABLED"),
      );
      expect(warns).toHaveLength(1);
      expect(warns[0].flag).toBe("APP_LOG_REDACT_ERR_URLS");
    } finally {
      if (prior === undefined) {
        delete process.env.APP_LOG_REDACT_ERR_URLS;
      } else {
        process.env.APP_LOG_REDACT_ERR_URLS = prior;
      }
    }
  });

  test("does not warn at defaults", () => {
    logger("warn-test", "trace", false, "test");
    const warns = warnEntries().filter((e) =>
      /redaction is (DISABLED|ENABLED)/.test(String(e.msg)),
    );
    expect(warns).toHaveLength(0);
  });

  test("only warns once across multiple logger constructions", () => {
    const prior = process.env.APP_LOG_REDACT_QUERY;
    process.env.APP_LOG_REDACT_QUERY = "false";
    try {
      logger("warn-test-1", "trace", false, "test");
      logger("warn-test-2", "trace", false, "test");
      logger("warn-test-3", "trace", false, "test");
      const warns = warnEntries().filter((e) =>
        String(e.msg).includes("query redaction is DISABLED"),
      );
      expect(warns).toHaveLength(1);
    } finally {
      if (prior === undefined) {
        delete process.env.APP_LOG_REDACT_QUERY;
      } else {
        process.env.APP_LOG_REDACT_QUERY = prior;
      }
    }
  });
});
