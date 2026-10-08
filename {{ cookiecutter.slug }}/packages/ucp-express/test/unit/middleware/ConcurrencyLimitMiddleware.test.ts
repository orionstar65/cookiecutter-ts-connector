import { describe, expect, vi, test, beforeEach } from "vitest";
import { EventEmitter } from "events";
import ConcurrencyLimitMiddleware from "@ucp/express/middleware/ConcurrencyLimitMiddleware.js";

function mockRequest() {
  return {} as Parameters<ReturnType<typeof ConcurrencyLimitMiddleware>>[0];
}

function mockResponse(connectorId: string) {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    locals: { connectorId },
    setHeader: vi.fn(),
  }) as unknown as Parameters<ReturnType<typeof ConcurrencyLimitMiddleware>>[1];
}

describe("ConcurrencyLimitMiddleware", () => {
  const globalMax = 3;
  const keyMax = 2;
  let middleware: ReturnType<typeof ConcurrencyLimitMiddleware>;

  beforeEach(() => {
    middleware = ConcurrencyLimitMiddleware({ globalMax, keyMax });
  });

  test("allows requests under global limit", () => {
    const next = vi.fn();
    const keys = ["a", "b", "c"];
    for (let i = 0; i < globalMax; i++) {
      middleware(mockRequest(), mockResponse(keys[i]), next);
    }
    expect(next).toHaveBeenCalledTimes(globalMax);
  });

  test("rejects with 429 when global limit is reached", () => {
    const next = vi.fn();
    // Fill global slots across different keys so per-key limit isn't hit
    middleware(mockRequest(), mockResponse("a"), next);
    middleware(mockRequest(), mockResponse("b"), next);
    middleware(mockRequest(), mockResponse("c"), next);
    expect(next).toHaveBeenCalledTimes(globalMax);

    const response = mockResponse("d");
    expect(() => middleware(mockRequest(), response, next)).toThrow(
      "Too many concurrent downloads",
    );
    // At 100% global saturation (3/3), Retry-After = ceil(1 + 9 * 1.0) = 10
    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "10");
    expect(next).toHaveBeenCalledTimes(globalMax);
  });

  test("rejects with 429 when per-key limit is reached", () => {
    const next = vi.fn();
    for (let i = 0; i < keyMax; i++) {
      middleware(mockRequest(), mockResponse("a"), next);
    }
    expect(next).toHaveBeenCalledTimes(keyMax);

    const response = mockResponse("a");
    expect(() => middleware(mockRequest(), response, next)).toThrow(
      "Too many concurrent downloads",
    );
    // At 100% per-key saturation (2/2), Retry-After = ceil(1 + 9 * 1.0) = 10
    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "10");
  });

  test("second connectorId succeeds when first is at per-key limit", () => {
    const next = vi.fn();
    for (let i = 0; i < keyMax; i++) {
      middleware(mockRequest(), mockResponse("a"), next);
    }
    // Different key should still work (global limit not reached)
    middleware(mockRequest(), mockResponse("b"), next);
    expect(next).toHaveBeenCalledTimes(keyMax + 1);
  });

  test("frees slot on response close", () => {
    const next = vi.fn();
    const response = mockResponse("a");
    middleware(mockRequest(), response, next);
    middleware(mockRequest(), mockResponse("a"), next);
    expect(next).toHaveBeenCalledTimes(2);

    // At per-key limit, next request would fail
    expect(() =>
      middleware(mockRequest(), mockResponse("a"), next),
    ).toThrow();

    // Close first response to free a slot
    response.emit("close");

    // Now it should succeed
    middleware(mockRequest(), mockResponse("a"), next);
    expect(next).toHaveBeenCalledTimes(3);
  });

  describe("Retry-After scales with saturation level", () => {
    const [largeGlobal, largePerKey] = [10, 5];

    test("sets Retry-After based on per-key 100% saturation", () => {
      // Use larger limits to observe intermediate saturation values
      const limits = { globalMax: largeGlobal, keyMax: largePerKey };
      const mw = ConcurrencyLimitMiddleware(limits);
      const next = vi.fn();

      // Fill 5 of 10 global slots across different keys (50% saturation)
      const keys = ["a", "b", "c", "d", "e"];
      for (let i = 0; i < 5; i++) {
        mw(mockRequest(), mockResponse(keys[i]), next);
      }

      // Now fill per-key "a" to its limit (5/5 = 100% per-key saturation)
      // Already have 1 for "a", add 4 more — but that would hit global 9/10
      // which is 90% global. Per-key "a" would be 5/5 = 100%.
      // max(0.9, 1.0) = 1.0 → ceil(1 + 9*1.0) = 10
      for (let i = 1; i < largePerKey; i++) {
        mw(mockRequest(), mockResponse("a"), next);
      }

      const responseAtPerKey = mockResponse("a");
      expect(() => mw(mockRequest(), responseAtPerKey, next)).toThrow();
      expect(responseAtPerKey.setHeader).toHaveBeenCalledWith("Retry-After", "10");
    });

    test("sets Retry-After based on full global saturation", () => {
      // New instance for isolated test
      const limits2 = { globalMax: largeGlobal, keyMax: largePerKey };
      const mw2 = ConcurrencyLimitMiddleware(limits2);
      const next2 = vi.fn();
      const keys2 = ["a", "b", "c", "d", "e", "f"];
      for (let i = 0; i < 6; i++) {
        mw2(mockRequest(), mockResponse(keys2[i]), next2);
      }
      // Fill remaining 4 global slots with different keys
      const keys3 = ["g", "h", "i", "j"];
      for (let i = 0; i < 4; i++) {
        mw2(mockRequest(), mockResponse(keys3[i]), next2);
      }
      // Global = 10/10 = 100%, per-key "k" = 0/5 = 0%
      // max(1.0, 0.0) = 1.0 → ceil(1 + 9*1.0) = 10
      const responseAtGlobal = mockResponse("k");
      expect(() => mw2(mockRequest(), responseAtGlobal, next2)).toThrow();
      expect(responseAtGlobal.setHeader).toHaveBeenCalledWith("Retry-After", "10");
    });
  });

  test("removes connectorId from map when count reaches zero", () => {
    const next = vi.fn();
    const response = mockResponse("a");
    middleware(mockRequest(), response, next);

    // Close to decrement to 0
    response.emit("close");

    // Should be able to fill up to perKeyMax again
    for (let i = 0; i < keyMax; i++) {
      middleware(mockRequest(), mockResponse("a"), next);
    }
    expect(next).toHaveBeenCalledTimes(keyMax + 1);
  });
});
