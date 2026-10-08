import { describe, expect, vi, test, beforeEach, type Mock } from "vitest";

const { mockParseBearerToken, mockVerify } = vi.hoisted(() => ({
  mockParseBearerToken: vi.fn<(token: string | undefined) => string | undefined>(),
  mockVerify: vi.fn<(token: string) => any>(),
}));

vi.mock("@ucp/express/auth.js", () => ({
  parseBearerToken: mockParseBearerToken,
  verify: mockVerify,
}));

const { default: AuthenticationMiddleware } = await import(
  "@ucp/express/middleware/AuthenticationMiddleware.js"
);

function mockRequest(authHeader?: string) {
  return {
    header(name: string) {
      if (name === "Authorization") return authHeader;
      return undefined;
    },
  } as Parameters<ReturnType<typeof AuthenticationMiddleware>>[0];
}

function mockResponse() {
  const res = {
    locals: {},
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Parameters<ReturnType<typeof AuthenticationMiddleware>>[1];
}

describe("AuthenticationMiddleware", () => {
  let middleware: ReturnType<typeof AuthenticationMiddleware>;

  beforeEach(() => {
    vi.clearAllMocks();
    middleware = AuthenticationMiddleware();
  });

  test("calls next when token is valid", async () => {
    mockParseBearerToken.mockReturnValue("valid-token");
    mockVerify.mockReturnValue({ sub: "user" });

    const req = mockRequest("Bearer valid-token");
    const res = mockResponse();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(mockParseBearerToken).toHaveBeenCalledWith("Bearer valid-token");
    expect(mockVerify).toHaveBeenCalledWith("valid-token");
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test("returns 401 when no Authorization header", async () => {
    mockParseBearerToken.mockReturnValue(undefined);

    const req = mockRequest();
    const res = mockResponse();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 401, status: "Unauthorized" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 401 when token verification fails", async () => {
    mockParseBearerToken.mockReturnValue("bad-token");
    mockVerify.mockReturnValue(false);

    const req = mockRequest("Bearer bad-token");
    const res = mockResponse();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("returns 401 when parseBearerToken returns empty string", async () => {
    mockParseBearerToken.mockReturnValue("");

    const req = mockRequest("BadFormat");
    const res = mockResponse();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
