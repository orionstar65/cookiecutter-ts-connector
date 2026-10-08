import { describe, expect, vi, test, beforeEach } from "vitest";

const { mockFromJson } = vi.hoisted(() => ({
  mockFromJson: vi.fn(),
}));

vi.mock("@bufbuild/protobuf", () => ({
  fromJson: mockFromJson,
}));

const { default: ValidationMiddleware } = await import(
  "@ucp/express/middleware/ValidationMiddleware.js"
);

function mockRequest(body: any = {}, query: any = {}) {
  return { body, query } as Parameters<ReturnType<typeof ValidationMiddleware>>[0];
}

function mockResponse() {
  return {} as Parameters<ReturnType<typeof ValidationMiddleware>>[1];
}

describe("ValidationMiddleware", () => {
  const bodySchema = { name: "TestBody" } as any;
  const querySchema = { name: "TestQuery" } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("calls next with no args when no options provided", async () => {
    const middleware = ValidationMiddleware();
    const next = vi.fn();

    await middleware(mockRequest(), mockResponse(), next);

    expect(mockFromJson).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  test("validates body against schema and passes", async () => {
    mockFromJson.mockReturnValue({});
    const middleware = ValidationMiddleware({ body: bodySchema });
    const body = { field: "value" };
    const next = vi.fn();

    await middleware(mockRequest(body), mockResponse(), next);

    expect(mockFromJson).toHaveBeenCalledWith(bodySchema, body);
    expect(next).toHaveBeenCalledWith();
  });

  test("calls next with 400 error when body validation fails", async () => {
    mockFromJson.mockImplementation(() => {
      throw new Error("invalid body");
    });
    const middleware = ValidationMiddleware({ body: bodySchema });
    const next = vi.fn();

    await middleware(mockRequest({ bad: true }), mockResponse(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400 }),
    );
  });

  test("validates query against schema and passes", async () => {
    mockFromJson.mockReturnValue({});
    const middleware = ValidationMiddleware({ query: querySchema });
    const query = { param: "value" };
    const next = vi.fn();

    await middleware(mockRequest({}, query), mockResponse(), next);

    expect(mockFromJson).toHaveBeenCalledWith(querySchema, query);
    expect(next).toHaveBeenCalledWith();
  });

  test("calls next with 400 error when query validation fails", async () => {
    mockFromJson.mockImplementation(() => {
      throw new Error("invalid query");
    });
    const middleware = ValidationMiddleware({ query: querySchema });
    const next = vi.fn();

    await middleware(mockRequest({}, { bad: true }), mockResponse(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400 }),
    );
  });

  test("validates both body and query when both provided", async () => {
    mockFromJson.mockReturnValue({});
    const middleware = ValidationMiddleware({ body: bodySchema, query: querySchema });
    const body = { field: "value" };
    const query = { param: "value" };
    const next = vi.fn();

    await middleware(mockRequest(body, query), mockResponse(), next);

    expect(mockFromJson).toHaveBeenCalledTimes(2);
    expect(mockFromJson).toHaveBeenCalledWith(bodySchema, body);
    expect(mockFromJson).toHaveBeenCalledWith(querySchema, query);
  });
});
