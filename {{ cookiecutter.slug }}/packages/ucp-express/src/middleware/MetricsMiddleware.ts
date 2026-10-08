import { Request, Response, NextFunction } from "express";
import prometheus from "prom-client";

import { MiddlewareHandler } from "@ucp/express/types.js";

/**
 * Paths excluded from request-level metrics to avoid polluting histograms
 * with high-frequency probe traffic.
 */
const HEALTHCHECK_PATHS = ["/", "/alive", "/ready", "/metrics", "/health"];

export interface MetricsOptions {
  /** Custom histogram bucket boundaries (seconds). */
  buckets?: number[];
  /** Prometheus registry. Defaults to `prometheus.register`. */
  registry?: prometheus.Registry;
  /** Additional paths to exclude from request metrics. */
  excludePaths?: string[];
}

/**
 * @constructor @function MetricsMiddleware
 *
 * Middleware that records request-level metrics aligned with the Google SRE
 * golden signals (latency, traffic, errors, saturation):
 *
 *   **Latency**  — `http_request_duration_seconds` histogram
 *   **Traffic**  — `http_requests_total` counter
 *   **Errors**   — `http_requests_total{status_code="5xx"}` (derived from traffic counter)
 *   **Saturation** — covered by `ConcurrencyLimitMiddleware` + default process metrics
 *
 * These metrics enable:
 *   - SLO tracking via histogram quantiles (e.g. "99% of requests < 1 s")
 *   - Error-budget burn-rate alerting (error ratio over sliding windows)
 *   - Traffic anomaly detection (request rate changes)
 *
 * @see https://sre.google/sre-book/monitoring-distributed-systems/
 * @see https://sre.google/sre-book/service-level-objectives/
 */
export default function MetricsMiddleware(
  options: MetricsOptions,
): MiddlewareHandler {
  const { buckets, registry, excludePaths } = options;

  const skipPaths = new Set([...HEALTHCHECK_PATHS, ...(excludePaths ?? [])]);

  // --- Latency: request duration histogram ---
  const requestDuration = new prometheus.Histogram({
    name: "http_request_duration_seconds",
    help: "Duration of HTTP requests in seconds.",
    labelNames: ["method", "route", "status_code"] as const,
    ...(buckets && { buckets }),
    registers: [registry ?? prometheus.register],
  });

  // --- Traffic + Errors: total request counter ---
  const requestsTotal = new prometheus.Counter({
    name: "http_requests_total",
    help: "Total number of HTTP requests.",
    labelNames: ["method", "route", "status_code"] as const,
    registers: [registry ?? prometheus.register],
  });

  // --- In-flight gauge (saturation signal for this middleware layer) ---
  const requestsInFlight = new prometheus.Gauge({
    name: "http_requests_in_flight",
    help: "Number of HTTP requests currently being processed.",
    labelNames: ["method"] as const,
    registers: [registry ?? prometheus.register],
  });

  return function (request: Request, response: Response, next: NextFunction) {
    if (skipPaths.has(request.path)) {
      next();
      return;
    }

    const startTime = process.hrtime.bigint();

    requestsInFlight.inc({ method: request.method });

    response.on("finish", () => {
      const durationNs = Number(process.hrtime.bigint() - startTime);
      const durationSec = durationNs / 1e9;

      // Normalize the route label: use the matched Express route pattern when
      // available (e.g. "/contents/:id") to keep cardinality bounded, falling
      // back to the raw path for unmatched routes.

      const route: string = request.route?.path ?? request.path;
      const statusCode = String(response.statusCode);
      const labels = { method: request.method, route, status_code: statusCode };

      requestDuration.observe(labels, durationSec);
      requestsTotal.inc(labels);
      requestsInFlight.dec({ method: request.method });
    });

    next();
  };
}
