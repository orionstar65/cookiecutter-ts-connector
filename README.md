# `cookiecutter-typescript-connector`

## Description

`cookiecutter-typescript-connector` is a personal Cookiecutter template for
generating the stubs for an Express app that implements the Universal Connector
Protocol (UCP). Licensed under Apache-2.0.

## Usage

Render the template from this repository:

```shell
cookiecutter gh:orionstar65/cookiecutter-typescript-connector
```

You will be prompted for author, username, email, connector name, slug, package
name, version, and description. Defaults are set for a personal standalone
project under `orionstar65`.

Example session:

```shell
  [1/8] author (Orion Star):
  [2/8] username (orionstar65):
  [3/8] email (orionstar0605@gmail.com):
  [4/8] name (Hello Connector): Test Connector
  [5/8] slug (test-connector):
  [6/8] package (test_connector):
  [7/8] version (0.0.0):
  [8/8] description (Example Connector.):
```

The new package is generated in your current working directory. The
`hooks/post_gen_project.sh` hook initializes git and creates the first commit:

```text
Generated from gh:orionstar65/cookiecutter-typescript-connector
```

Generated projects vendor UCP runtime packages under `packages/`:

- `packages/ucp-express` (`@ucp/express`)
- `packages/ucp-api-schema-connect` (`@ucp/api-schema-connect`)

Those are local `file:` dependencies, so installs do not need a private registry.

When you are ready to publish, create a GitHub repository under your account and
push `main`.

Happy templating!
