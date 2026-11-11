# {{ cookiecutter.slug }}

## {{ cookiecutter.name }}

{{ cookiecutter.description }}

### Setup

[ ] TODO: Document setup steps to create a service account.

### Client

[ ] TODO: Document the supported auth methods in `client.ts`.

### Resolver

[ ] TODO: Document the supported URL patterns in `resolver.ts`.

## Contributing

The core driving philosophy behind the Language Platforms Templates is to
lean into language-specific, open source build tooling. This ensures that we
are more likely to align with tools that new hires are familiar with from
their previous experiences.

In TypeScript Platforms Templates, we rely heavily on core `npm` features
to ensure maximum interoperability with previous experiences.

Key development workflows _mostly_ use `npm run ${script}`, so it is important
to read through the default `package.json:scripts` block before developing
new services using the templates.

The following are key local development workflows that every developer should
familiarize themselves with in order to develop, test, and release TypeScript
services and packages.

### Install

```shell
npm run login && npm install
```

TypeScript services use a mixture of `private` and `public` ESM modules.

In order to ensure repeatable installs of private modules (if you use any),
`package.json` provides optional `login` scripts for registry and container
auth (configured in `.npmrc.example` / generated `.npmrc` and your cloud provider).

The following scripts can help engineers:

- install `@{{ cookiecutter.username }}`-scoped packages from npm/GitHub Packages
- download `docker` and `helm` artifacts from your chosen registry

```json
{
  "scripts": {
    "login": "npm run login:npm && npm run login:docker && npm run login:helm",
    "login:npm": "npx google-artifactregistry-auth",
    "login:docker": "gcloud auth configure-docker \"us-docker.pkg.dev\"",
    "login:helm": "gcloud auth application-default print-access-token | helm registry login -u oauth2accesstoken --password-stdin https://us-docker.pkg.dev",
  }
}
```

### Build

```shell
npm run build
```

It is important to always check that our TypeScript code builds correctly,
otherwise we cannot release a `docker` image, especially since we use ESM
modules extensively across backend TypeScript.

```json
{
  "scripts": {
    "clean": "shx rm -rf ./dist ./.logs",
    "prebuild": "npm run clean",
    "build": "tsc --build && tsc-alias"
  }
}
```

Check out `tsconfig.json` to learn more about the different customizations
we have enabled on the standard `tsc --build`!

- `tsc-alias`
- `tsconfig-paths`

### Develop

```shell
npm run docker
```

When developing locally, we use `docker compose` to confirm the portability
of TypeScript applications; however, due to current limitations in private
package distribution, we pass an `NPM_TOKEN` into our `docker builds` as a
`--build-arg`.

To ensure a seamless development experience, we provide a simple `docker`
script to build and up the services in `docker-compose.yaml`.

To run a specific `docker-compose.yaml` service, run:

```shell
# npm run docker ${service}
npm run docker app
```

```json
{
  "scripts": {
    "predocker": "npm run docker:build",
    "docker": "docker compose up",
    "docker:build": "docker compose build --build-arg NPM_TOKEN=$(gcloud auth print-access-token)"
  }
}
```

### Test

```shell
npm test
```

`npm` provides its own test entrypoint that ultimately just executes
`npm run test`. Typescript Platforms projects use `ts-jest` as their `jest`
transformer.

To isolate a specific test suite from the `test/` directory, pass in a `suite`
as an extra terminal argument.

```shell
# npm test ${suite}
npm test contracts
```

Additionally, TypeScript Platforms projects run linting `pretest`. In the event
that linting errors (and they will!), you can always run the `format` script
to fix it.

```shell
npm run format
```

> **ASIDE:** `preformat` & `postformat`
>
> The `preformat` script asserts that there are no unstaged `git diffs`.
>
> This means that we _must_ commit business logic before we can format it.
>
> We do this to ensure that `format` is an atomic operation that gets its own
> commit during `postformat`.

```json
{
  "scripts": {
    "preformat": "git diff --quiet",
    "format": "prettier --write src && git diff",
    "lint": "tslint src/**/*.ts && prettier --check src",
    "test": "NODE_OPTIONS=\"--experimental-vm-modules\" jest",
    "postformat": "git commit -am \"'npm run format'\""
  }
}
```

### Release

```shell
npm version ${major | minor | patch}
```

`npm` also provides an `npm version` command to assist with semantically
versioning `package.json`. By default, this command:

- Increments the `version` property in `package.json`,
- Commits this change atomically with message `${version}`, and
- Adds a new `git tag` for `v${version}`.

Additionally, TypeScript Platforms projects run testing `preversion` to
ensure this version doesn't introduce regressions.

```json
{
  "scripts": {
    "preversion": "npm run test"
  }
}
```

Once you've merged your PR and you're ready to trigger a tagged release push
your tags.

```shell
git push --tags
```

In the event that `bitbucket-pipelines.yml` fails, you may need to delete
and re-tag using the following commands:

```shell
git tag --delete ${tag}
git push --delete origin ${tag}
git tag ${tag}
git push --tags
```
