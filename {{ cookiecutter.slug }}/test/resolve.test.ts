import fs from "fs";
import { describe, expect, test } from "@jest/globals";

import * as pb from "@bufbuild/protobuf";
import { ServiceConnectSchema } from "@ucp/api-schema-connect/ext/access/v1/org/service_pb.js";

import client from "@{{ cookiecutter.username }}/{{ cookiecutter.slug }}/client.js";
import resolver from "@{{ cookiecutter.username }}/{{ cookiecutter.slug }}/resolver.js";

const secret = process.env.APP_ACCESS_CONFIG_PATH!;
const { data } = JSON.parse(fs.readFileSync(secret, { encoding: "utf8" }));
const credential = pb.fromJson(ServiceConnectSchema, data);

/**
 * A resolver _should_ resolve a URI to a `FileSystemEntry`.
 *
 * The `resolver` is responsible for resolving `sourceLocations` to their
 * canonical forms. This might involve complexities like:
 *
 *   - standardizing character encodings
 *   - following symlinks (or redirects)
 *   - complex parsing
 *
 * The purpose of this test is to ensure that we catch resolution errors.
 */
describe("Test resolver", () => {
  test.each([
    {
      case: "Directory",
      kind: "local#directory",
      src: "file://path/to",
      tgt: "file://path/to",
    },
    {
      case: "File",
      kind: "local#directory",
      src: "file://path/to/source.txt",
      tgt: "file://path/to/target.txt",
    },
  ])("should resolve $case", async ({ kind, src, tgt }) => {
    const c = await client.connect(credential);
    const resolved = resolver.resolve(src, c);
    expect(resolved.kind).toBe(kind);
    expect(resolved.toString()).toBe(tgt);
  });
});
