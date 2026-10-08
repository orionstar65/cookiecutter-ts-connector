import { describe, expect, vi, test, beforeEach } from "vitest";

const { mockReadFileSync, mockFromJson } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockFromJson: vi.fn(),
}));

vi.mock("fs", () => ({
  default: { readFileSync: mockReadFileSync },
}));

vi.mock("@bufbuild/protobuf", () => ({
  fromJson: mockFromJson,
}));

vi.mock(
  "@ucp/api-schema-connect/ext/access/v1/org/service_pb.js",
  () => ({ ServiceConnectSchema: {} }),
);

const { default: LocalAccessMiddleware } = await import(
  "@ucp/express/middleware/LocalAccessMiddleware.js"
);

const fakeAccess = {
  authority: "test-authority",
  connectConfig: { key: "value" },
};

function mockRequest(connectorId: string = "connector-1") {
  return {
    params: { connectorId },
  } as unknown as Parameters<ReturnType<typeof LocalAccessMiddleware>>[0];
}

function mockResponse() {
  return {
    locals: {},
  } as unknown as Parameters<ReturnType<typeof LocalAccessMiddleware>>[1];
}

describe("LocalAccessMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_ACCESS_CONFIG_PATH = "/fake/config.json";
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ data: { authority: "test-authority" } }),
    );
    mockFromJson.mockReturnValue(fakeAccess);
  });

  test("reads config from APP_ACCESS_CONFIG_PATH on construction", () => {
    LocalAccessMiddleware();

    expect(mockReadFileSync).toHaveBeenCalledWith("/fake/config.json", "utf8");
    expect(mockFromJson).toHaveBeenCalled();
  });

  test("populates response.locals with access data", async () => {
    const middleware = LocalAccessMiddleware();
    const req = mockRequest("connector-1");
    const res = mockResponse();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.locals.connectorId).toBe("connector-1");
    expect(res.locals.access).toBe(fakeAccess);
    expect(res.locals.authority).toBe("test-authority");
    expect(res.locals.credential).toEqual({ key: "value" });
    expect(next).toHaveBeenCalled();
  });

  test("sets connectorId from request params", async () => {
    const middleware = LocalAccessMiddleware();
    const req = mockRequest("other-connector");
    const res = mockResponse();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.locals.connectorId).toBe("other-connector");
  });
});
