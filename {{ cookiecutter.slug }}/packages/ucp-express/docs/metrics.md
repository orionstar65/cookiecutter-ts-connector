# Metrics

`@ucp/express` exposes a Prometheus-compatible `/metrics` endpoint that serves
all registered metrics in the OpenMetrics text format. Metrics are split into
three layers:

1. **Process / runtime metrics** — Node.js internals (CPU, memory, GC, event
   loop) collected automatically by `prom-client`.
2. **Application metrics** — the `up` gauge that signals liveness.
3. **Request metrics** — per-request golden signals recorded by
   `MetricsMiddleware`.

All metrics share a common set of default labels applied at server startup:

| Label     | Source                   | Example         |
| --------- | ------------------------ | --------------- |
| `host`    | `settings.root.hostname` | `connector.svc` |
| `env`     | `settings.env`           | `production`    |
| `version` | `settings.version`       | `1.7.0`         |

---

## Table of Contents

- [Request Metrics (Golden Signals)](#request-metrics-golden-signals)
  - [http_request_duration_seconds](#http_request_duration_seconds)
  - [http_requests_total](#http_requests_total)
  - [http_requests_in_flight](#http_requests_in_flight)
- [Application Metrics](#application-metrics)
  - [up](#up)
- [Process / Runtime Metrics](#process--runtime-metrics)
  - [CPU](#cpu)
  - [Memory & Heap](#memory--heap)
  - [Event Loop](#event-loop)
  - [Garbage Collection](#garbage-collection)
  - [Active Handles & Requests](#active-handles--requests)
  - [Version Info](#version-info)
- [SRE Usage Guide](#sre-usage-guide)
  - [SLO Tracking](#slo-tracking)
  - [Error Budget Burn Rate](#error-budget-burn-rate)
  - [Practical Alerting](#practical-alerting)

---

## Request Metrics (Golden Signals)

Recorded by `MetricsMiddleware` (`src/middleware/MetricsMiddleware.ts`). These
implement the
[four golden signals](https://sre.google/sre-book/monitoring-distributed-systems/#xref_monitoring_golden-signals)
from Google's SRE handbook.

Healthcheck paths (`/`, `/alive`, `/ready`, `/metrics`, `/health`) are excluded
from all request metrics to avoid polluting histograms with probe traffic.

### http_request_duration_seconds

| Property   | Value                            |
| ---------- | -------------------------------- |
| **Type**   | Histogram                        |
| **Signal** | Latency                          |
| **Labels** | `method`, `route`, `status_code` |
| **Unit**   | Seconds                          |

Duration of HTTP requests measured from middleware entry to the response
`"finish"` event. The `route` label uses the Express route pattern (e.g.
`/contents/:id`) when available, falling back to the raw path for unmatched
routes. This keeps label cardinality bounded.

**Default bucket boundaries (seconds):**

```
0.005  0.01  0.025  0.05  0.1  0.25  0.5  1  2.5  5  10  30  60  120
```

These cover fast API calls (5 ms) through large file downloads (120 s) and let
you derive SLO burn rates at common quantile thresholds:

| Quantile | Typical range | Use case               |
| -------- | ------------- | ---------------------- |
| p50      | 0.1 -- 0.25 s | Median user experience |
| p90      | 0.5 -- 1 s    | Tail latency baseline  |
| p99      | 2.5 -- 10 s   | SLO breach detection   |

Custom buckets can be passed via `MetricsMiddleware({ buckets: [...] })`.

### http_requests_total

| Property   | Value                            |
| ---------- | -------------------------------- |
| **Type**   | Counter                          |
| **Signal** | Traffic + Errors                 |
| **Labels** | `method`, `route`, `status_code` |

Total number of HTTP requests. This single counter serves double duty:

- **Traffic** — `rate(http_requests_total[5m])` gives requests per second.
- **Errors** — filter by `status_code=~"5.."` for the error signal.

### http_requests_in_flight

| Property   | Value      |
| ---------- | ---------- |
| **Type**   | Gauge      |
| **Signal** | Saturation |
| **Labels** | `method`   |

Number of HTTP requests currently being processed. Incremented when the
middleware runs, decremented when the response `"finish"` event fires.
Complements the per-connector saturation tracked by
`ConcurrencyLimitMiddleware`.

---

## Application Metrics

Registered in `configureMetrics()` (`src/index.ts`).

### up

| Property   | Value                    |
| ---------- | ------------------------ |
| **Type**   | Gauge                    |
| **Labels** | `host`, `env`, `version` |
| **Values** | `1` = up, `0` = not up   |

Set to `1` at server startup. Standard liveness signal for Prometheus blackbox
monitoring and `up == 0` dead-instance alerts.

---

## Process / Runtime Metrics

Collected automatically by `prom-client`'s `collectDefaultMetrics()`, called in
`configureMetrics()`. All carry the default `host`, `env`, `version` labels.

### CPU

| Metric                             | Type    | Description                                     |
| ---------------------------------- | ------- | ----------------------------------------------- |
| `process_cpu_user_seconds_total`   | Counter | Total user CPU time spent in seconds            |
| `process_cpu_system_seconds_total` | Counter | Total system CPU time spent in seconds          |
| `process_cpu_seconds_total`        | Counter | Total user + system CPU time spent in seconds   |
| `process_start_time_seconds`       | Gauge   | Start time of the process (unix epoch, seconds) |

### Memory & Heap

| Metric                                   | Type  | Description                            |
| ---------------------------------------- | ----- | -------------------------------------- |
| `process_resident_memory_bytes`          | Gauge | Resident memory size in bytes (RSS)    |
| `nodejs_heap_size_total_bytes`           | Gauge | V8 heap total size in bytes            |
| `nodejs_heap_size_used_bytes`            | Gauge | V8 heap used size in bytes             |
| `nodejs_external_memory_bytes`           | Gauge | Memory used by C++ objects bound to JS |
| `nodejs_heap_space_size_total_bytes`     | Gauge | Heap space total, by space name        |
| `nodejs_heap_space_size_used_bytes`      | Gauge | Heap space used, by space name         |
| `nodejs_heap_space_size_available_bytes` | Gauge | Heap space available, by space name    |

### Event Loop

| Metric                                | Type  | Description                             |
| ------------------------------------- | ----- | --------------------------------------- |
| `nodejs_eventloop_lag_seconds`        | Gauge | Event loop lag in seconds               |
| `nodejs_eventloop_lag_min_seconds`    | Gauge | Minimum recorded event loop delay       |
| `nodejs_eventloop_lag_max_seconds`    | Gauge | Maximum recorded event loop delay       |
| `nodejs_eventloop_lag_mean_seconds`   | Gauge | Mean of recorded event loop delays      |
| `nodejs_eventloop_lag_stddev_seconds` | Gauge | Standard deviation of event loop delays |
| `nodejs_eventloop_lag_p50_seconds`    | Gauge | 50th percentile event loop delay        |
| `nodejs_eventloop_lag_p90_seconds`    | Gauge | 90th percentile event loop delay        |
| `nodejs_eventloop_lag_p99_seconds`    | Gauge | 99th percentile event loop delay        |

### Garbage Collection

| Metric                       | Type      | Description                                                     |
| ---------------------------- | --------- | --------------------------------------------------------------- |
| `nodejs_gc_duration_seconds` | Histogram | GC duration by kind (`major`, `minor`, `incremental`, `weakcb`) |

### Active Handles & Requests

| Metric                          | Type  | Description                             |
| ------------------------------- | ----- | --------------------------------------- |
| `nodejs_active_resources`       | Gauge | Active resources by async resource type |
| `nodejs_active_resources_total` | Gauge | Total number of active resources        |
| `nodejs_active_handles`         | Gauge | Active libuv handles by handle type     |
| `nodejs_active_handles_total`   | Gauge | Total number of active handles          |
| `nodejs_active_requests`        | Gauge | Active libuv requests by request type   |
| `nodejs_active_requests_total`  | Gauge | Total number of active requests         |

### Version Info

| Metric                | Type  | Description                                         |
| --------------------- | ----- | --------------------------------------------------- |
| `nodejs_version_info` | Gauge | Node.js version (labels: `major`, `minor`, `patch`) |

---

## SRE Usage Guide

### SLO Tracking

Define service-level objectives on the histogram quantiles. For example, a "99%
of requests complete in under 1 second" SLO:

```promql
# Current p99 latency
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))

# SLO compliance ratio (fraction of requests under 1s)
sum(rate(http_request_duration_seconds_bucket{le="1"}[5m]))
/
sum(rate(http_request_duration_seconds_count[5m]))
```

### Error Budget Burn Rate

Compute the error ratio over sliding windows to detect how fast the error budget
is being consumed:

```promql
# Error ratio (5xx / total) over 1 hour
sum(rate(http_requests_total{status_code=~"5.."}[1h]))
/
sum(rate(http_requests_total[1h]))

# Burn rate: actual error ratio divided by budget
# For a 99.9% availability SLO (budget = 0.001):
(
  sum(rate(http_requests_total{status_code=~"5.."}[1h]))
  /
  sum(rate(http_requests_total[1h]))
)
/ 0.001
```

A burn rate of `1` means you're consuming the budget exactly as planned. A burn
rate above `1` means you're burning faster than the budget allows. Use
multi-window alerts (fast burn on short windows, slow burn on long windows) for
robust detection:

| Alert       | Short window | Long window | Burn rate | Fires when                   |
| ----------- | ------------ | ----------- | --------- | ---------------------------- |
| Page (fast) | 5m           | 1h          | 14.4x     | Budget exhausted in ~1 hour  |
| Page (slow) | 30m          | 6h          | 6x        | Budget exhausted in ~6 hours |
| Ticket      | 2h           | 1d          | 3x        | Budget exhausted in ~3 days  |

### Practical Alerting

Combine the golden signals for actionable alerting rules:

```promql
# HIGH LATENCY: p99 exceeds SLO threshold for 5 minutes
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m])) > 1.0

# HIGH ERROR RATE: more than 1% of requests are 5xx over 5 minutes
sum(rate(http_requests_total{status_code=~"5.."}[5m]))
/
sum(rate(http_requests_total[5m]))
> 0.01

# SATURATION: in-flight requests approaching capacity
http_requests_in_flight > 80

# EVENT LOOP STALL: lag exceeding 100ms indicates thread blocking
nodejs_eventloop_lag_p99_seconds > 0.1

# MEMORY PRESSURE: heap usage above 90% of total
nodejs_heap_size_used_bytes / nodejs_heap_size_total_bytes > 0.9
```

See the
[Google SRE chapter on practical alerting](https://sre.google/sre-book/practical-alerting/)
for guidance on tuning alert thresholds and routing.
