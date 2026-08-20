# Overview

Personal Cookiecutter template that scaffolds a TypeScript **UCP (Universal
Connector Protocol)** connector Express service.

Generated packages are named `@<username>/<slug>` (default
`@orionstar65/<slug>`) and target GitHub as the project home.

## Stack

- **Language / runtime**: TypeScript on Node.js 22+
- **Web framework**: Express `^5.2`, plus vendored `@ucp/express`
  (`packages/ucp-express`)
- **Schema / protobuf**: vendored `@ucp/api-schema-connect`
  (`packages/ucp-api-schema-connect`)
- **Tests**: Jest + ts-jest + Supertest
- **Packaging**: npm, Docker, optional Helm chart wrapper

## Template inputs (`cookiecutter.json`)

- `author`, `username`, `email`
- `name`, `slug` (slugified name), `package` (slug with `_`)
- `version`, `description`

## Generated layout (high level)

- `src/index.ts` — Express server entry; mounts connector routes
- `src/routes.ts` — UCP route handlers
- `src/client.ts` — authenticated client against the system of record
- `src/resolver.ts` — URI → URL resolution helpers
- `src/transforms.ts` — response mapping helpers
- `test/` — contract and integration-style suites
- `helm/` — optional deploy chart
- `Dockerfile` / `docker-compose.yaml` — local container workflow

## Local development

```shell
cookiecutter gh:orionstar65/cookiecutter-typescript-connector
cd <slug>
npm install
npm run build
npm test
```

Path alias `@<username>/<slug>/*` → `./src/*` is configured in `tsconfig.json`
and Jest `moduleNameMapper`.

Environment defaults live in the rendered `.env` file using `APP_*` variables.

## Publishing

Defaults point at:

- GitHub repository URLs under `github.com/<username>/<slug>`
- npm public registry
- optional GHCR image/Helm destinations under `ghcr.io/<username>/...`

Adjust registry and CI settings in the generated project for your own infra.
