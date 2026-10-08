import { describe, expect, vi, test, beforeEach } from "vitest";
import { EventEmitter } from "events";
import prometheus from "prom-client";

import MetricsMiddleware from "@ucp/express/middleware/MetricsMiddleware.js";

type Middleware = ReturnType<typeof MetricsMiddleware>;
type Req = Parameters<Middleware>[0];
type Res = Parameters<Middleware>[1];

function mockRequest(
  method: string = "GET",
  path: string = "/test",
  routePath?: string,
): Req {
  const req: any = { method, path, route: routePath ? { path: routePath } : undefined };
  return req as Req;
}

function mockResponse(statusCode: number = 200): Res {
  const emitter = new EventEmitter();
  return Object.assign(emitter, { statusCode, locals: {} }) as unknown as Res;
}

describe("MetricsMiddleware", () => {
  let registry: prometheus.Registry;

  beforeEach(() => {
    registry = new prometheus.Registry();
  });

  test("calls next for every request", async () => {
    const middleware = MetricsMiddleware({ registry });
    const next = vi.fn();

    await middleware(mockRequest(), mockResponse(), next);

    expect(next).toHaveBeenCalled();
  });

  test("records duration histogram on response finish", async () => {
    const middleware = MetricsMiddleware({ registry });
    const res = mockResponse(200);
    const next = vi.fn();

    await middleware(mockRequest("GET", "/api/data"), res, next);
    res.emit("finish");

    const metric = await registry.getSingleMetricAsString(
      "http_request_duration_seconds",
    );
    expect(metric).toContain('method="GET"');
    expect(metric).toContain('status_code="200"');
    expect(metric).toContain('route="/api/data"');
  });

  test("increments request counter on response finish", async () => {
    const middleware = MetricsMiddleware({ registry });
    const res = mockResponse(201);
    const next = vi.fn();

    await middleware(mockRequest("POST", "/api/items"), res, next);
    res.emit("finish");

    const metric = await registry.getSingleMetricAsString("http_requests_total");
    expect(metric).toContain('method="POST"');
    expect(metric).toContain('status_code="201"');
  });

  test("uses Express route pattern when available for bounded cardinality", async () => {
    const middleware = MetricsMiddleware({ registry });
    const res = mockResponse(200);
    const next = vi.fn();

    await middleware(
      mockRequest("GET", "/contents/abc-123", "/contents/:id"),
      res,
      next,
    );
    res.emit("finish");

    const metric = await registry.getSingleMetricAsString("http_requests_total");
    expect(metric).toContain('route="/contents/:id"');
    expect(metric).not.toContain("abc-123");
  });

  test("tracks in-flight requests gauge", async () => {
    const middleware = MetricsMiddleware({ registry });
    const res = mockResponse(200);
    const next = vi.fn();

    await middleware(mockRequest(), res, next);

    // Before finish: in-flight should be 1
    const before = await registry.getSingleMetricAsString(
      "http_requests_in_flight",
    );
    expect(before).toContain("1");

    res.emit("finish");

    // After finish: in-flight should be 0
    const after = await registry.getSingleMetricAsString(
      "http_requests_in_flight",
    );
    expect(after).toContain("0");
  });

  test.each(["/", "/alive", "/ready", "/metrics", "/health"])(
    "skips healthcheck path %s",
    async (path) => {
      const middleware = MetricsMiddleware({ registry });
      const res = mockResponse(200);
      const next = vi.fn();

      await middleware(mockRequest("GET", path), res, next);

      expect(next).toHaveBeenCalled();

      // Metric exists but should have no recorded values for skipped paths
      const metrics = await registry.getMetricsAsJSON();
      const requestMetric = metrics.find(
        (m) => m.name === "http_requests_total",
      );
      expect(requestMetric?.values).toHaveLength(0);
    },
  );

  test("skips custom excluded paths", async () => {
    const middleware = MetricsMiddleware({
      registry,
      excludePaths: ["/internal/debug"],
    });
    const res = mockResponse(200);
    const next = vi.fn();

    await middleware(mockRequest("GET", "/internal/debug"), res, next);

    expect(next).toHaveBeenCalled();
    // Metrics are registered but should have no recorded values
    const metrics = await registry.getMetricsAsJSON();
    for (const m of metrics) {
      expect(m.values).toHaveLength(0);
    }
  });

  test("records 5xx status codes for error budget tracking", async () => {
    const middleware = MetricsMiddleware({ registry });
    const res = mockResponse(503);
    const next = vi.fn();

    await middleware(mockRequest("GET", "/api/data"), res, next);
    res.emit("finish");

    const metric = await registry.getSingleMetricAsString("http_requests_total");
    expect(metric).toContain('status_code="503"');
  });

  test("accepts custom histogram buckets", async () => {
    const customBuckets = [0.1, 0.5, 1, 5];
    const middleware = MetricsMiddleware({ registry, buckets: customBuckets });
    const res = mockResponse(200);
    const next = vi.fn();

    await middleware(mockRequest(), res, next);
    res.emit("finish");

    const metric = await registry.getSingleMetricAsString(
      "http_request_duration_seconds",
    );
    // Custom buckets should appear; default fine-grained buckets should not
    expect(metric).toContain('le="0.1"');
    expect(metric).toContain('le="5"');
    expect(metric).not.toContain('le="0.005"');
  });

  test("handles multiple concurrent requests correctly", async () => {
    const middleware = MetricsMiddleware({ registry });
    const next = vi.fn();

    const res1 = mockResponse(200);
    const res2 = mockResponse(404);
    const res3 = mockResponse(500);

    await middleware(mockRequest("GET", "/a"), res1, next);
    await middleware(mockRequest("POST", "/b"), res2, next);
    await middleware(mockRequest("GET", "/c"), res3, next);

    // 3 in-flight
    const inFlight = await registry.getSingleMetricAsString(
      "http_requests_in_flight",
    );
    // GET should show 2, POST should show 1
    expect(inFlight).toContain("2");
    expect(inFlight).toContain("1");

    res1.emit("finish");
    res2.emit("finish");
    res3.emit("finish");

    // All counters should reflect the 3 requests
    const total = await registry.getSingleMetricAsString("http_requests_total");
    expect(total).toContain('status_code="200"');
    expect(total).toContain('status_code="404"');
    expect(total).toContain('status_code="500"');
  });
});
