import { describe, expect, test } from "vitest";

import { parseBearerToken, readSigningKey } from "@ucp/express/auth.js";

describe("auth", () => {
  describe("parseBearerToken", () => {
    test("returns token from valid Bearer header", () => {
      expect(parseBearerToken("Bearer abc123")).toBe("abc123");
    });

    test("is case-insensitive for Bearer prefix", () => {
      expect(parseBearerToken("bearer abc123")).toBe("abc123");
    });

    test("returns undefined for undefined input", () => {
      expect(parseBearerToken(undefined)).toBeUndefined();
    });

    test("returns undefined for empty string", () => {
      expect(parseBearerToken("")).toBeUndefined();
    });

    test("returns undefined for missing scheme", () => {
      expect(parseBearerToken("abc123")).toBeUndefined();
    });

    test("returns undefined for wrong scheme", () => {
      expect(parseBearerToken("Basic abc123")).toBeUndefined();
    });

    test("returns undefined for too many parts", () => {
      expect(parseBearerToken("Bearer abc 123")).toBeUndefined();
    });
  });

  describe("readSigningKey", () => {
    test("throws on unsupported file extension", () => {
      expect(() => readSigningKey("/some/path/key.pem")).toThrow(
        "SignatureReadError: Unsupported file extension",
      );
    });

    test("throws on extensionless path", () => {
      expect(() => readSigningKey("/some/path/key")).toThrow(
        "SignatureReadError: Unsupported file extension",
      );
    });
  });
});
