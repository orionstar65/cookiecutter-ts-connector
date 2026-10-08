# @ucp/ucp-express

UCP Express utilities: middleware, healthchecks, auth, etc.

## Prerequisites

- Node.js (LTS)
- npm

## Getting Started

```bash
npm install
npm run build
```

## Scripts

| Command          | Description                                              |
| ---------------- | -------------------------------------------------------- |
| `npm run build`  | Compile TypeScript and path aliases (`tsc-alias`)        |
| `npm run check`  | Type-check without emitting (`tsc --noEmit`)             |
| `npm run lint`   | ESLint + Prettier check on `src/`                        |
| `npm run format` | Auto-fix: Prettier + ESLint on `src/` and Markdown files |
| `npm run test`   | Lint (pretest hook), then run Vitest                     |
| `npm run clean`  | Remove ignored files                                     |
| `npm run login`  | Authenticate `npm install` with Google Artifact Registry |
| `npm run update` | Update all dependencies and audit                        |

Run a single test file:

```bash
npm test pass.test.ts
```

## Log sanitization

The pino logger sanitizes query values and URL path+search before they
are persisted. Two env flags control behavior:

| Flag                            | Default | Effect                                                                  |
| ------------------------------- | ------- | ----------------------------------------------------------------------- |
| `APP_LOG_REDACT_QUERY=false`  | enabled | Disable access-log query/URL redaction (incident-only emergency switch). |
| `APP_LOG_REDACT_ERR_URLS=true` | disabled | Also hash URLs inside error logs.                                       |

Deviations from the default emit a `warn` at logger construction so the
operational choice is visible in startup logs.

The `ucp-loghash` CLI ships with this package — see `bin/ucp-loghash.mjs`
— and lets operators recompute the sanitized hash for a value so they can
grep production logs without exposing raw URLs to the search tool. Run
`ucp-loghash --help` for usage.

Working manual with debug patterns:
[`LOG_SANITIZATION.md`](../../LOG_SANITIZATION.md) in the connectors
monorepo root.

## Project Structure

```
.claude/  # Landing for `claude` planning docs, skills, etc.
build/    # `npm pack` output (for )
dist/     # Compiled output (git-ignored)
docs/     # Human-readable documentation
src/      # TypeScript source
test/     # Unit tests
```

## Architecture

- **ESM-only** (`"type": "module"`) — imports require `.js` extensions in source
  even though files are `.ts`.
- Path alias `@ucp/ucp-express` maps to `./src` (configured in
  both `tsconfig.json` and `vitest.config.ts`).
- `tsc-alias` runs as a `postbuild` step to rewrite path aliases in compiled
  output.
- The package self-references via `"@ucp/ucp-express": "file:src"`
  in `devDependencies` for import testing.

## Tooling

- **TypeScript** — strict compilation via `@tsconfig/node-lts`
- **ESLint** — flat config (`eslint.config.mjs`) with `typescript-eslint`
  strict + stylistic presets
- **Prettier** — 80 char width, 2-space indent, trailing commas, semicolons
- **Vitest** — native ESM + TypeScript support; `@dotenvx/dotenvx` loaded for
  env var support

## Contributing

### Setup

1. Clone the repository:

   ```bash
   git clone git@github.com:orionstar65/ucp-express.git
   cd ucp-express
   npm install
   ```

2. Verify everything works:

   ```bash
   npm run build
   npm test
   ```

### Development Workflow

1. Create a feature branch from `main`:

   ```bash
   git checkout -b feature/my-change
   ```

2. Make your changes in `src/`.

3. Format and lint before committing:

   ```bash
   npm run format
   npm run lint
   ```

4. Run the full test suite:

   ```bash
   npm test
   ```

5. Push your branch and open a pull request against `main`.

### Code Style

- Follow the existing ESLint and Prettier configuration — run `npm run format`
  to auto-fix.
- Write tests for new functionality in `test/`.
- Keep imports using the `@ucp/ucp-express` path alias where
  appropriate.

## CI/CD Pipeline (Bitbucket Pipelines)

Every push triggers the default pipeline:

1. **Build** — `npm install` + `npm run build`
2. **Test** — `npm run lint` + `npm run test`

### Release Process

Releases are published to Google Artifact Registry and triggered by version
tags.

1. Ensure your branch is merged to `main` and all tests pass.

2. Bump the version (this runs tests automatically via the `preversion` hook):

   ```bash
   npm version patch   # 0.0.0 → 0.0.1
   npm version minor   # 0.0.0 → 0.1.0
   npm version major   # 0.0.0 → 1.0.0
   ```

   `npm version` automatically creates a git commit and a `v*` tag.

3. Push the commit and tag:

   ```bash
   git push origin main --follow-tags
   ```

4. The `v*` tag triggers the release pipeline:

   **Build** → **Test** → **Release** (`npm publish --registry $NPM_REGISTRY`)

The package is then available in the UCP Google Artifact Registry.

## License

UNLICENSED — proprietary to UCP.
