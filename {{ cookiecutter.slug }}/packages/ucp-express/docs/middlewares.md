# Middlewares

`@ucp/express` ships a set of Express middleware factories in the
`middleware/` submodule. Every export is a **factory function** that returns an
Express handler -- call the factory with its configuration, then pass the result
to `app.use()`.

```ts
import { LoggingMiddleware } from "@ucp/express/middleware/index.js";
// or import directly:
import LoggingMiddleware from "@ucp/express/middleware/LoggingMiddleware.js";
```

> **Deprecated aliases** -- the barrel re-exports `Authenticated`,
> `StandardErrorHandler`, `StandardLogging`, `AccessServiceAuth`, `LocalAuth`,
> and `validate` still work but will be removed in a future major version.
> Prefer the `*Middleware` names.

---

## Table of Contents

| Middleware                                                | Typical Position | Purpose                                               |
| --------------------------------------------------------- | ---------------- | ----------------------------------------------------- |
| [LoggingMiddleware](#loggingmiddleware)                   | First            | Request/response logging with bunyan                  |
| [ResponseMetadata](#responsemetadata)                     | Early            | Attach request/response IDs and timing                |
| [MetricsMiddleware](#metricsmiddleware)                   | Early            | Prometheus request metrics (golden signals)           |
| [AuthenticationMiddleware](#authenticationmiddleware)     | Before routes    | JWT bearer token verification                         |
| [RemoteAccessMiddleware](#remoteaccessmiddleware)         | After auth       | Fetch connector credentials from Access Service       |
| [LocalAccessMiddleware](#localaccessmiddleware)           | After auth       | Load connector credentials from a local file          |
| [ValidationMiddleware](#validationmiddleware)             | Per-route        | Validate request body/query against protobuf schemas  |
| [ConcurrencyLimitMiddleware](#concurrencylimitmiddleware) | Per-route        | Enforce global and per-connector download concurrency |
| [ErrorHandlerMiddleware](#errorhandlermiddleware)         | Last             | Catch-all error handler                               |

---

## LoggingMiddleware

Structured request/response logging via bunyan. For every non-healthcheck
request it logs an `"info"` entry on arrival, then a status-appropriate entry
(`info` / `warn` / `error`) when the response finishes. Healthcheck paths
(`/alive`, `/ready`, `/metrics`, `/stats`, `/health`) are silently skipped to
keep logs clean.

The middleware also guarantees an `x-request-id` header exists on every request
-- if the caller did not supply one, a UUID v4 is generated. A child logger
scoped to `"response"` is attached at `response.locals.logger` so downstream
handlers can log with request context.

**Signature**

```ts
function LoggingMiddleware(logger: bunyan.Logr): MiddlewareHandler;
```

**Parameters**

| Name     | Type          | Description                                             |
| -------- | ------------- | ------------------------------------------------------- |
| `logger` | `bunyan.Logr` | Parent logger instance. A child is derived per request. |

**Response log levels**

| Status range | Level   |
| ------------ | ------- |
| 1xx -- 3xx   | `info`  |
| 4xx          | `warn`  |
| 5xx          | `error` |

**Usage**

```ts
import bunyan from "bunyan";
import express from "express";
import LoggingMiddleware from "@ucp/express/middleware/LoggingMiddleware.js";

const logger = bunyan.createLogger({ name: "my-service", level: "info" });
const app = express();

// Mount first so every downstream handler is logged.
app.use(LoggingMiddleware(logger));
```

---

## ResponseMetadata

Attaches per-response metadata to `response.locals` and sets standard tracing
headers on the outgoing response.

**Signature**

```ts
function ResponseMetadata(): MiddlewareHandler;
```

**What it sets**

| Location          | Key             | Value                                      |
| ----------------- | --------------- | ------------------------------------------ |
| `response.locals` | `id`            | UUID v4 (unique response identifier)       |
| `response.locals` | `startTimeMs`   | `Date.now()` at middleware entry           |
| Response header   | `X-Request-Id`  | Forwarded from the incoming request header |
| Response header   | `X-Response-Id` | Same as `response.locals.id`               |

**Usage**

```ts
import express from "express";
import ResponseMetadata from "@ucp/express/middleware/ResponseMetadata.js";

const app = express();
app.use(ResponseMetadata());

app.get("/example", (req, res) => {
  // response.locals.id and response.locals.startTimeMs are available here
  const elapsed = Date.now() - res.locals.startTimeMs;
  res.json({ responseId: res.locals.id, elapsedMs: elapsed });
});
```

---

## MetricsMiddleware

Records per-request metrics aligned with the
[Google SRE golden signals](https://sre.google/sre-book/monitoring-distributed-systems/):

| Signal         | Metric                          | Type      | Labels                           |
| -------------- | ------------------------------- | --------- | -------------------------------- |
| **Latency**    | `http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` |
| **Traffic**    | `http_requests_total`           | Counter   | `method`, `route`, `status_code` |
| **Errors**     | (derived from traffic with 5xx) | --        | --                               |
| **Saturation** | `http_requests_in_flight`       | Gauge     | `method`                         |

Healthcheck paths (`/`, `/alive`, `/ready`, `/metrics`, `/health`) are excluded
to keep metrics clean. The `route` label prefers the Express route pattern (e.g.
`/contents/:id`) over the raw path to keep label cardinality bounded.

These metrics enable:

- **SLO tracking** — histogram quantiles give you p50/p90/p99 latency for
  service-level objectives.
- **Error-budget burn-rate alerting** — ratio of 5xx responses over sliding
  windows tells you how fast you're burning your error budget.
- **Traffic anomaly detection** — request rate changes surface load shifts.

**Signature**

```ts
function MetricsMiddleware(options?: MetricsOptions): MiddlewareHandler;

interface MetricsOptions {
  buckets?: number[]; // histogram bucket boundaries (seconds)
  registry?: prometheus.Registry; // defaults to prometheus.register
  excludePaths?: string[]; // additional paths to skip
}
```

**Usage**

```ts
import express from "express";
import MetricsMiddleware from "@ucp/express/middleware/MetricsMiddleware.js";

const app = express();

// Default options — uses standard buckets and the global registry
app.use(MetricsMiddleware());

// Custom options — tighter buckets for a latency-sensitive service
app.use(
  MetricsMiddleware({
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1],
    excludePaths: ["/internal/debug"],
  }),
);
```

---

## AuthenticationMiddleware

Verifies the `Authorization: Bearer <token>` header on every request. Extracts
the token with `auth.parseBearerToken`, then cryptographically verifies it with
`auth.verify` (JWS / HMAC). Requests with a missing or invalid token receive a
`401 Unauthorized` JSON response and are **not** forwarded to downstream
handlers.

**Signature**

```ts
function AuthenticationMiddleware(): MiddlewareHandler;
```

**401 response body**

```json
{ "code": 401, "status": "Unauthorized", "time": 1710000000000 }
```

**Usage**

```ts
import express from "express";
import AuthenticationMiddleware from "@ucp/express/middleware/AuthenticationMiddleware.js";

const app = express();

// Protect all routes below this point.
app.use(AuthenticationMiddleware());

app.get("/secure", (req, res) => {
  res.json({ message: "You are authenticated" });
});
```

---

## RemoteAccessMiddleware

Fetches the connector's `ServiceConnect` credential from the UCP Access
Service over HTTP. On success it populates `response.locals` with the
connector's identity and credentials so that downstream route handlers can
interact with the external data source.

Internally it creates an axios client pointed at
`{settings.root}/api/access/v1alpha1` with exponential-backoff retries (5
attempts). The caller's bearer token is forwarded to the Access Service.

> **Ordering** -- mount this **after** `AuthenticationMiddleware` so the token
> has already been verified.

**Signature**

```ts
function RemoteAccessMiddleware(settings: AppSettings): MiddlewareHandler;
```

**Parameters**

| Name       | Type          | Description                                                |
| ---------- | ------------- | ---------------------------------------------------------- |
| `settings` | `AppSettings` | Must include `name` and `root` (base URL of the platform). |

**What it sets on `response.locals`**

| Key           | Value                                       |
| ------------- | ------------------------------------------- |
| `connectorId` | From `request.params.connectorId`           |
| `access`      | Full deserialized `ServiceConnect` protobuf |
| `authority`   | `access.authority`                          |
| `credential`  | `access.connectConfig`                      |

**Error behaviour**

| Condition                      | HTTP status                                |
| ------------------------------ | ------------------------------------------ |
| Missing bearer token           | 401                                        |
| Missing `connectorId` param    | 400                                        |
| Access Service request failure | Forwarded to error handler via `next(err)` |

**Usage**

```ts
import express from "express";
import AuthenticationMiddleware from "@ucp/express/middleware/AuthenticationMiddleware.js";
import RemoteAccessMiddleware from "@ucp/express/middleware/RemoteAccessMiddleware.js";

const app = express();

const settings = {
  name: "my-connector",
  root: new URL("https://platform.ucp.com"),
};

app.use(AuthenticationMiddleware());

// :connectorId must be in the route for RemoteAccessMiddleware to read it.
app.use("/:connectorId/*", RemoteAccessMiddleware(settings));

app.post("/:connectorId/contents:pull", (req, res) => {
  const { connectorId, credential } = res.locals;
  // credential is now available for the downstream handler
  res.json({ connectorId });
});
```

---

## LocalAccessMiddleware

A development/docker-compose alternative to `RemoteAccessMiddleware`. Instead of
calling the Access Service over the network, it reads a `ServiceConnect` JSON
file from disk at construction time. Every request then receives the same
pre-loaded credentials in `response.locals`.

**Signature**

```ts
function LocalAccessMiddleware(): MiddlewareHandler;
```

**Environment requirements**

| Variable                   | Description                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `APP_ACCESS_CONFIG_PATH` | Absolute path to a JSON file containing a valid `ServiceConnect` under a `data` key. |

**What it sets on `response.locals`**

Same shape as `RemoteAccessMiddleware`: `connectorId`, `access`, `authority`,
`credential`.

**Usage**

```ts
import express from "express";
import LocalAccessMiddleware from "@ucp/express/middleware/LocalAccessMiddleware.js";

// Requires APP_ACCESS_CONFIG_PATH to be set in the environment.
const app = express();

app.use("/:connectorId/*", LocalAccessMiddleware());

app.post("/:connectorId/contents:pull", (req, res) => {
  const { credential } = res.locals;
  res.json({ ok: true });
});
```

---

## ValidationMiddleware

Validates `request.body` and/or `request.query` against `@bufbuild/protobuf`
message schemas using `fromJson`. If deserialization throws, a `400 Bad Request`
error is forwarded via `next(err)`.

**Signature**

```ts
function ValidationMiddleware(options?: ValidationOptions): MiddlewareHandler;

interface ValidationOptions {
  body?: DescMessage; // protobuf schema for request body
  query?: DescMessage; // protobuf schema for query string
}
```

**Parameters**

| Name            | Type          | Description                                                    |
| --------------- | ------------- | -------------------------------------------------------------- |
| `options.body`  | `DescMessage` | Optional. Protobuf schema to validate `request.body` against.  |
| `options.query` | `DescMessage` | Optional. Protobuf schema to validate `request.query` against. |

If neither option is provided the middleware is effectively a pass-through.

**Usage**

```ts
import express from "express";
import { PullContentsRequestSchema } from "@ucp/api-schema-connect/ext/ucp/v1/service_pb.js";
import ValidationMiddleware from "@ucp/express/middleware/ValidationMiddleware.js";

const app = express();
app.use(express.json());

app.post(
  "/:connectorId/contents:pull",
  ValidationMiddleware({ body: PullContentsRequestSchema }),
  (req, res) => {
    // request.body is guaranteed to conform to PullContentsRequest
    res.json({ ok: true });
  },
);
```

---

## ConcurrencyLimitMiddleware

Enforces a two-level concurrency cap on in-flight requests: a **global** maximum
across all connectors and a **per-key** maximum for each individual connector
(keyed by `response.locals.connectorId`). When either limit is reached the
middleware throws a `429 Too Many Requests` with a `Retry-After` header whose
value scales linearly with the saturation ratio (1 -- 10 seconds).

Slots are acquired synchronously and released on the response `"close"` event,
so they are freed regardless of whether the response succeeds or errors.

**Signature**

```ts
function ConcurrencyLimitMiddleware(
  limits: ConcurrencyLimits,
): MiddlewareHandler;

interface ConcurrencyLimits {
  globalMax: number; // max concurrent across all connectors
  keyMax: number; // max concurrent per connectorId
}
```

**Retry-After calculation**

```
saturation = max(globalActive / globalMax, keyActive / keyMax)
retryAfter = clamp(ceil(1 + 9 * saturation), 1, 10)
```

**Usage**

```ts
import express from "express";
import ConcurrencyLimitMiddleware from "@ucp/express/middleware/ConcurrencyLimitMiddleware.js";

const app = express();

// Allow 50 total concurrent downloads, max 10 per connector.
const downloadLimiter = ConcurrencyLimitMiddleware({
  globalMax: 50,
  keyMax: 10,
});

// Apply only to the download route (not discovery or metadata).
app.post("/:connectorId/content-data:download", downloadLimiter, (req, res) => {
  // Safe to proceed -- concurrency is within limits.
  res.json({ downloading: true });
});
```

---

## ErrorHandlerMiddleware

Express error handler (4-arity signature). Must be the **last** middleware
mounted. Catches any error that reaches it, logs the error, and sends a
structured JSON response.

- `HttpError` instances (from `http-errors`) preserve their status code and
  message.
- All other errors produce a generic `500 Internal Server Error` with the
  message `"Something Broke"`.
- In development mode (`settings.dev === true`) the stack trace is included in
  the response body. In production it is omitted.

**Signature**

```ts
function ErrorHandlerMiddleware(
  settings: ExpressSettings,
  logger: bunyan.Logr,
): ErrorHandler;
```

**Parameters**

| Name       | Type              | Description                              |
| ---------- | ----------------- | ---------------------------------------- |
| `settings` | `ExpressSettings` | Controls dev-mode stack trace inclusion. |
| `logger`   | `bunyan.Logr`     | Logger for error-level output.           |

**Response body shape**

```json
{
  "message": "not here",
  "status": 404,
  "reason": "Not Found",
  "stack": "Error: not here\n    at ..."
}
```

(`stack` only present when `settings.dev` is `true`.)

**Usage**

```ts
import bunyan from "bunyan";
import express from "express";
import ErrorHandlerMiddleware from "@ucp/express/middleware/ErrorHandlerMiddleware.js";

const logger = bunyan.createLogger({ name: "my-service", level: "info" });
const settings = { /* ... */ dev: process.env.NODE_ENV !== "production" };
const app = express();

// ... mount all routes and middleware above ...

// Must be last.
app.use(ErrorHandlerMiddleware(settings, logger));
```

---

## Complete Example

A connector service that uses every middleware in the recommended order.

```ts
import bunyan from "bunyan";
import express from "express";
import cors from "cors";
import { PullContentsRequestSchema } from "@ucp/api-schema-connect/ext/ucp/v1/service_pb.js";

import LoggingMiddleware from "@ucp/express/middleware/LoggingMiddleware.js";
import ResponseMetadata from "@ucp/express/middleware/ResponseMetadata.js";
import MetricsMiddleware from "@ucp/express/middleware/MetricsMiddleware.js";
import AuthenticationMiddleware from "@ucp/express/middleware/AuthenticationMiddleware.js";
import RemoteAccessMiddleware from "@ucp/express/middleware/RemoteAccessMiddleware.js";
import LocalAccessMiddleware from "@ucp/express/middleware/LocalAccessMiddleware.js";
import ValidationMiddleware from "@ucp/express/middleware/ValidationMiddleware.js";
import ConcurrencyLimitMiddleware from "@ucp/express/middleware/ConcurrencyLimitMiddleware.js";
import ErrorHandlerMiddleware from "@ucp/express/middleware/ErrorHandlerMiddleware.js";
import { ExpressSettings } from "@ucp/express/settings.js";

// ── Settings ────────────────────────────────────────────────────────
const settings: ExpressSettings = {
  name: "my-connector",
  env: process.env.NODE_ENV || "local",
  dev: process.env.NODE_ENV !== "production",
  root: new URL(process.env.ROOT_URL || "http://localhost:8081"),
  log: { level: "info", src: true },
  server: {
    timeout: 120_000,
    requestTimeout: 60_000,
    keepAliveTimeout: 65_000,
    maxConnections: 1024,
  },
};

const logger = bunyan.createLogger({
  name: settings.name,
  level: settings.log.level as bunyan.LogLevel,
});

// ── App ─────────────────────────────────────────────────────────────
const app = express();

// 1. Logging first -- captures every request including healthchecks.
app.use(LoggingMiddleware(logger));

// 2. Standard body parsing and CORS.
app.use(cors());
app.use(express.json());

// 3. Response metadata -- attaches IDs and timing to every response.
app.use(ResponseMetadata());

// 4. Prometheus metrics (noop stub, ready for future implementation).
app.use(MetricsMiddleware());

// 5. Authentication -- rejects unauthenticated requests before they
//    reach any route handler.
app.use(AuthenticationMiddleware());

// 6. Credential loading -- use RemoteAccessMiddleware in deployed
//    environments and LocalAccessMiddleware for local development.
const accessMiddleware = settings.dev
  ? LocalAccessMiddleware()
  : RemoteAccessMiddleware(settings);

app.use("/:connectorId/*", accessMiddleware);

// 7. Concurrency limiter -- applied only to the download route.
const downloadLimiter = ConcurrencyLimitMiddleware({
  globalMax: 50,
  keyMax: 10,
});

// ── Routes ──────────────────────────────────────────────────────────
app.post(
  "/:connectorId/contents\\:pull",
  ValidationMiddleware({ body: PullContentsRequestSchema }),
  (req, res) => {
    const { connectorId, credential } = res.locals;
    res.json({ connectorId, items: [] });
  },
);

app.post(
  "/:connectorId/content-data\\:download",
  downloadLimiter,
  (req, res) => {
    const { connectorId, credential } = res.locals;
    res.json({ connectorId, downloading: true });
  },
);

// 8. Error handler -- must be last.
app.use(ErrorHandlerMiddleware(settings, logger));

// ── Start ───────────────────────────────────────────────────────────
app.listen(Number(settings.root.port) || 8081, () => {
  logger.info(`Listening at ${settings.root.href}`);
});
```

### Middleware ordering at a glance

```
Request
  │
  ├─ LoggingMiddleware          ← log every request, set x-request-id
  ├─ express.json()             ← parse body
  ├─ ResponseMetadata           ← attach response IDs and timing
  ├─ MetricsMiddleware          ← (noop) prometheus metrics
  ├─ AuthenticationMiddleware   ← verify JWT, reject 401
  ├─ Remote/LocalAccess         ← load connector credentials
  │
  ├─ [per-route]
  │   ├─ ValidationMiddleware   ← validate body/query against protobuf
  │   ├─ ConcurrencyLimit       ← enforce download concurrency cap
  │   └─ Route handler
  │
  └─ ErrorHandlerMiddleware     ← catch-all, must be last
```
