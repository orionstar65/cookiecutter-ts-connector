import { describe, expect, vi, test, beforeEach } from "vitest";

// Hoisted seams shared with the vi.mock factory below.
const { poolConstructorArgs, mockUndiciRequest, mockParseBearerToken } =
  vi.hoisted(() => ({
    poolConstructorArgs: [] as string[],
    mockUndiciRequest: vi.fn<(...args: any[]) => any>(),
    mockParseBearerToken: vi.fn<
      (token: string | undefined) => string | undefined
    >(),
  }));

// Mock Pool to enforce undici's bare-origin contract (regression fence for
// the 1.10.2 / 1.10.3 boot crash) and mock RetryAgent.request so tests can
// drive responses without a real dispatcher.
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  function MockPool(origin: string) {
    poolConstructorArgs.push(origin);
    const url = new URL(origin);
    if (url.pathname !== "/" || url.search || url.hash) {
      throw new actual.errors.InvalidArgumentError("invalid url");
    }
    return {} as unknown as InstanceType<typeof actual.Pool>;
  }
  class MockRetryAgent {
    request = mockUndiciRequest;
  }
  return {
    ...actual,
    Pool: MockPool as unknown as typeof actual.Pool,
    RetryAgent: MockRetryAgent as unknown as typeof actual.RetryAgent,
  };
});

vi.mock("@ucp/express/auth.js", () => ({
  parseBearerToken: mockParseBearerToken,
}));

vi.mock("@bufbuild/protobuf", () => ({
  fromJson: vi.fn((_schema: any, data: any) => data),
}));

vi.mock(
  "@ucp/api-schema-connect/ext/access/v1/org/service_pb.js",
  () => ({ ServiceConnectSchema: {} }),
);

const { default: RemoteAccessMiddleware } = await import(
  "@ucp/express/middleware/RemoteAccessMiddleware.js"
);

const DEFAULT_ROOT = new URL("http://localhost:9999");
const BASE_PATH = "/api/access/v1alpha1";
const DEFAULT_ACCESS = {
  authority: "auth-A",
  connectConfig: { token: "x" },
};

function buildSettings(root: URL = DEFAULT_ROOT) {
  return { name: "test", root };
}

function reply(statusCode: number, jsonBody?: unknown, textBody = "") {
  return {
    statusCode,
    body: {
      json: () => Promise.resolve(jsonBody),
      text: () => Promise.resolve(textBody),
    },
  };
}

function buildRequest(
  connectorId: string | undefined,
  authHeader?: string,
  extraHeaders: Record<string, string> = {},
) {
  return {
    params: { connectorId },
    header(name: string) {
      if (name === "Authorization") return authHeader;
      return extraHeaders[name];
    },
    get(name: string) {
      return extraHeaders[name];
    },
  } as unknown as Parameters<ReturnType<typeof RemoteAccessMiddleware>>[0];
}

// Happy-path defaults; override only the fields each test cares about.
async function runRequest(
  overrides: {
    connectorId?: string;
    authHeader?: string;
    bearerToken?: string | undefined;
    reply?: ReturnType<typeof reply>;
    rejectWith?: Error;
    headers?: Record<string, string>;
    settings?: ReturnType<typeof buildSettings>;
  } = {},
) {
  const {
    connectorId = "connector-1",
    authHeader = "Bearer valid-token",
    bearerToken = "valid-token",
    reply: replyValue = reply(200, { data: DEFAULT_ACCESS }),
    rejectWith,
    headers = {},
    settings = buildSettings(),
  } = overrides;

  mockParseBearerToken.mockReturnValue(bearerToken);
  if (rejectWith) {
    mockUndiciRequest.mockRejectedValue(rejectWith);
  } else {
    mockUndiciRequest.mockResolvedValue(replyValue);
  }

  const middleware = RemoteAccessMiddleware(settings);
  const res = { locals: {} } as unknown as Parameters<
    ReturnType<typeof RemoteAccessMiddleware>
  >[1];
  const next = vi.fn();
  await middleware(buildRequest(connectorId, authHeader, headers), res, next);
  return { res, next };
}

beforeEach(() => {
  poolConstructorArgs.length = 0;
  vi.clearAllMocks();
});

describe("RemoteAccessMiddleware", () => {
  // Group A — fences the 1.10.2 / 1.10.3 boot crash (path-bearing URL → Pool).
  describe("Group A — construction-time origin parsing", () => {
    test.each([
      ["bare origin", "https://host"],
      ["trailing slash", "https://host/"],
      ["non-default port", "https://host:8082"],
      ["http localhost", "http://localhost:9999"],
      ["root with subpath", "https://host/v2"],
    ])("does not throw for %s (%s)", (_label, raw) => {
      expect(() =>
        RemoteAccessMiddleware(buildSettings(new URL(raw))),
      ).not.toThrow();
    });

    test("Pool receives a bare-origin URL (pathname === '/', no path)", () => {
      RemoteAccessMiddleware(buildSettings(new URL("https://host:8082")));
      expect(poolConstructorArgs).toEqual(["https://host:8082"]);
      const url = new URL(poolConstructorArgs[0]);
      expect(url.pathname).toBe("/");
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
    });

    test("absolute API path overrides any path on settings.root", () => {
      RemoteAccessMiddleware(buildSettings(new URL("https://host/v2")));
      expect(poolConstructorArgs).toEqual(["https://host"]);
    });
  });

  // Group B — fences the silent path-dropping bug (basePath must be prepended).
  describe("Group B — request URL composition", () => {
    test("happy path resolves to <base>/service-connects/<id>", async () => {
      const { next } = await runRequest({ connectorId: "connector-1" });
      expect(mockUndiciRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          path: `${BASE_PATH}/service-connects/connector-1`,
        }),
      );
      expect(next).toHaveBeenCalledWith();
    });

    test.each([
      "acme-prod-01",
      "6f1c5b8e-1234-4abc-9def-0123456789ab",
      "svc_connect_42",
    ])("composes path verbatim for connectorId %s", async (id) => {
      await runRequest({ connectorId: id });
      expect(mockUndiciRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          path: `${BASE_PATH}/service-connects/${id}`,
        }),
      );
    });

    test("reuses closure-captured basePath across sequential requests", async () => {
      mockParseBearerToken.mockReturnValue("valid-token");
      mockUndiciRequest.mockResolvedValue(reply(200, { data: DEFAULT_ACCESS }));
      const middleware = RemoteAccessMiddleware(buildSettings());
      const next = vi.fn();
      await middleware(
        buildRequest("first", "Bearer t"),
        { locals: {} } as any,
        next,
      );
      await middleware(
        buildRequest("second", "Bearer t"),
        { locals: {} } as any,
        next,
      );
      expect(mockUndiciRequest.mock.calls.map((args) => args[0].path)).toEqual([
        `${BASE_PATH}/service-connects/first`,
        `${BASE_PATH}/service-connects/second`,
      ]);
    });
  });

  describe("Group C — header forwarding", () => {
    test("forwards caller-supplied X-Request-Id verbatim", async () => {
      await runRequest({ headers: { "X-Request-Id": "trace-123" } });
      expect(mockUndiciRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Request-Id": "trace-123",
            Authorization: "Bearer valid-token",
          }),
        }),
      );
    });

    test("generates a UUID v4 X-Request-Id when caller does not provide one", async () => {
      await runRequest();
      expect(mockUndiciRequest.mock.calls[0][0].headers["X-Request-Id"]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });
  });

  describe("Group D — successful response shape", () => {
    test("populates response.locals from a 200 OK access response", async () => {
      const { res, next } = await runRequest();
      expect(res.locals.connectorId).toBe("connector-1");
      expect(res.locals.access).toEqual(DEFAULT_ACCESS);
      expect(res.locals.authority).toBe("auth-A");
      expect(res.locals.credential).toEqual({ token: "x" });
      expect(next).toHaveBeenCalledWith();
    });
  });

  // Group E — bypasses runRequest() because it must pass undefined explicitly.
  describe("Group E — auth and input guards", () => {
    test.each([
      ["missing Authorization → 401", undefined, "connector-1", 401],
      ["empty bearer token → 401", "", "connector-1", 401],
      ["missing connectorId → 400", "valid-token", undefined, 400],
      ["empty connectorId → 400", "valid-token", "", 400],
    ])(
      "%s",
      async (_label, bearerToken, connectorId, expectedStatus) => {
        mockParseBearerToken.mockReturnValue(bearerToken as string | undefined);
        mockUndiciRequest.mockResolvedValue(
          reply(200, { data: DEFAULT_ACCESS }),
        );
        const middleware = RemoteAccessMiddleware(buildSettings());
        const next = vi.fn();
        await middleware(
          buildRequest(
            connectorId as string | undefined,
            bearerToken ? `Bearer ${bearerToken}` : undefined,
          ),
          { locals: {} } as any,
          next,
        );
        expect(next).toHaveBeenCalledWith(
          expect.objectContaining({ statusCode: expectedStatus }),
        );
      },
    );
  });

  describe("Group F — access service non-2xx responses", () => {
    test.each([
      [401, "unauthorized"],
      [403, "forbidden"],
      [404, ""],
      [500, "boom"],
    ])("propagates upstream %i", async (status, body) => {
      const { next } = await runRequest({
        reply: reply(status, undefined, body),
      });
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: status }),
      );
    });

    test("status 299 is treated as success (boundary)", async () => {
      const { next } = await runRequest({
        reply: reply(299, { data: DEFAULT_ACCESS }),
      });
      expect(next).toHaveBeenCalledWith();
    });

    test("status 300 is treated as failure (boundary)", async () => {
      const { next } = await runRequest({
        reply: reply(300, undefined, "redirect"),
      });
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 300 }),
      );
    });
  });

  describe("Group G — network and dispatcher errors", () => {
    test("propagates a connection-refused style error", async () => {
      const { next } = await runRequest({
        rejectWith: new Error("connection refused"),
      });
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe("Group I — Pool / closure isolation", () => {
    test("separate factory calls construct separate Pools", () => {
      RemoteAccessMiddleware(buildSettings(new URL("https://a.example")));
      RemoteAccessMiddleware(buildSettings(new URL("https://b.example")));
      expect(poolConstructorArgs).toEqual([
        "https://a.example",
        "https://b.example",
      ]);
    });

    test("Pool is constructed once per factory invocation, not per request", async () => {
      mockParseBearerToken.mockReturnValue("valid-token");
      mockUndiciRequest.mockResolvedValue(reply(200, { data: DEFAULT_ACCESS }));
      const middleware = RemoteAccessMiddleware(buildSettings());
      expect(poolConstructorArgs).toHaveLength(1);

      const next = vi.fn();
      await middleware(buildRequest("a", "Bearer t"), { locals: {} } as any, next);
      await middleware(buildRequest("b", "Bearer t"), { locals: {} } as any, next);

      expect(poolConstructorArgs).toHaveLength(1);
    });
  });
});
