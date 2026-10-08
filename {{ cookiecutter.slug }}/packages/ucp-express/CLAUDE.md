# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## What this package is

`@ucp/express` is a shared Express utility library used by all connector
services in the UCP monorepo. It provides a pre-configured Express `Server`
class with built-in health checks, Prometheus metrics, structured logging
(Pino/StackDriver), JWT auth, request validation (protobuf schemas), and
standard middleware (CORS, error handling, request tracing, concurrency limits).

This is a **library package**, not a standalone service. Connectors import it as
`@ucp/express/*.js`.

## Commands

```bash
npm run build        # TypeScript compile (tsc) + path alias rewrite (tsc-alias)
npm run test         # Type-check + lint then run Vitest with coverage
npm run check        # TypeScript type-check only (tsc --noEmit)
npm run lint         # ESLint + Prettier check on src/
npm run format       # Prettier write + ESLint fix on src/ and docs

# Run a single test file:
npm test test/unit/utils.test.ts
```

`npm run test` runs `npm run check && npm run lint` as a pretest hook, so
type errors and lint failures block tests.

## Module system

ESM-only (`"type": "module"` in package.json). TypeScript targets ES2022 with
`moduleResolution: "Bundler"`. All internal imports use the
`@ucp/express/<module>.js` path alias (with `.js` extension), never relative
paths. The alias is mapped in tsconfig `paths` and vitest `resolve.alias`.

## Architecture

- **`index.ts`** — Barrel re-export of `server.js`, `settings.js`, and
  `middleware/index.js`. Default export is `Server`.
- **`server.ts`** — `Server` class: constructs an Express app with locals, health
  check routes (`/`, `/alive`, `/ready`), Prometheus metrics (`/metrics`), and
  default middleware. `start()` binds the HTTP server with configurable timeouts
  from `ServerSettings`.
- **`settings.ts`** — `getCurrentSettings()` builds `ExpressSettings` from
  `process.env` with sensible defaults. Exports interfaces: `ExpressSettings`,
  `AppSettings`, `ConnectorSettings`, `ServerSettings`, `AuthSettings`.
- **`middleware/`** — Each middleware is its own file exporting a default factory
  function that returns an Express handler:
  - `AuthenticationMiddleware` — JWT bearer token verification
  - `ConcurrencyLimitMiddleware` — Limits concurrent in-flight requests
  - `ErrorHandlerMiddleware` — Standard error serialization
  - `LocalAccessMiddleware` — Reads credentials from a mounted secrets file
  - `LoggingMiddleware` — Structured request/response logging
  - `MetricsMiddleware` — Prometheus request metrics
  - `RemoteAccessMiddleware` — Pulls credentials from UCP Access Service via
    axios+retry
  - `ResponseMetadata` — Adds standard response headers
  - `ValidationMiddleware` — Validates request body/query against
    `@bufbuild/protobuf` schemas
- **`auth.ts`** — JWT operations using `jws`: `AutoRefreshToken` class
  (self-refreshing signed tokens), `verify`, `parseBearerToken`,
  `readSigningKey`, `ImpersonateOrgAdmin`.
- **`utils.ts`** — HTTP Range header parsing (`RangeHeader`,
  `ContentRangeHeader`, `rangeToSpan`) and `safeFromJson` for strict protobuf
  deserialization.
- **`logger.ts`** — Pino logger factory with StackDriver-compatible JSON output
  and custom request/response serializers.
- **`types.ts`** — Express handler type aliases: `ErrorHandler`, `RouteHandler`,
  `MiddlewareHandler`.

## Key conventions

- Path alias: always import as `@ucp/express/<module>.js` (with `.js`
  extension), never relative paths.
- Middleware follows the factory pattern: exported functions return Express
  middleware handlers. Each middleware lives in its own file under `src/middleware/`.
- Settings are driven entirely by environment variables with fallback defaults —
  see `settings.ts` for the full list of `APP_*` env vars.
- Protobuf schemas come from `@ucp/api-schema-connect` (Connect/buf
  ecosystem).
- Tests live in `test/unit/` mirroring the `src/` structure.
- ESLint disables `no-explicit-any`, `no-inferrable-types`,
  `no-non-null-assertion`, `no-unused-vars`, and `no-unused-expressions`.

## Monorepo rules (inherited from parent CLAUDE.md)

- **Never push directly to `main`** — all changes go through pull requests.
- **No `Co-Authored-By:` lines in commit messages.**
