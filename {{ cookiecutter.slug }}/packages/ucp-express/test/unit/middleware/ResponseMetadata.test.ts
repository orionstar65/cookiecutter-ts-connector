import { describe, expect, vi, test, type Mock } from "vitest";
import ResponseMetadata from "@ucp/express/middleware/ResponseMetadata.js";

function mockRequest(requestId?: string) {
  return {
    header(name: string) {
      if (name === "X-Request-Id") return requestId;
      return undefined;
    },
  } as Parameters<ReturnType<typeof ResponseMetadata>>[0];
}

function mockResponse() {
  return {
    locals: {},
    setHeaders: vi.fn(),
  } as unknown as Parameters<ReturnType<typeof ResponseMetadata>>[1];
}

describe("ResponseMetadata", () => {
  const middleware = ResponseMetadata();

  test("sets response.locals.id as a UUID", async () => {
    const res = mockResponse();
    const next = vi.fn();

    await middleware(mockRequest(), res, next);

    expect(res.locals.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test("sets response.locals.startTimeMs", async () => {
    const before = Date.now();
    const res = mockResponse();
    const next = vi.fn();

    await middleware(mockRequest(), res, next);
    const after = Date.now();

    expect(res.locals.startTimeMs).toBeGreaterThanOrEqual(before);
    expect(res.locals.startTimeMs).toBeLessThanOrEqual(after);
  });

  test("sets X-Request-Id and X-Response-Id headers", async () => {
    const res = mockResponse();
    const next = vi.fn();

    await middleware(mockRequest("req-id-123"), res, next);

    const headersMap = (res.setHeaders as Mock).mock.calls[0][0] as Map<string, string>;
    expect(headersMap.get("X-Request-Id")).toBe("req-id-123");
    expect(headersMap.get("X-Response-Id")).toBe(res.locals.id);
  });

  test("handles missing X-Request-Id header", async () => {
    const res = mockResponse();
    const next = vi.fn();

    await middleware(mockRequest(), res, next);

    const headersMap = (res.setHeaders as Mock).mock.calls[0][0] as Map<string, string>;
    expect(headersMap.get("X-Request-Id")).toBeUndefined();
    expect(headersMap.get("X-Response-Id")).toBe(res.locals.id);
  });

  test("calls next", async () => {
    const next = vi.fn();

    await middleware(mockRequest(), mockResponse(), next);

    expect(next).toHaveBeenCalled();
  });
});
