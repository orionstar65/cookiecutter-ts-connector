import { describe, expect, test } from "vitest";
import { EventEmitter } from "node:events";
import type { NextFunction, Request, Response } from "express";

import RequestAbortController, {
  REASON_CLIENT_DISCONNECT,
  isClientDisconnect,
} from "@ucp/express/middleware/RequestAbortController.js";

// Mock Express response just enough for the middleware. We need
// EventEmitter semantics (`on`, `off`, `emit`) plus a writable
// `writableEnded` flag and a `locals` object. The real
// `http.ServerResponse#writableEnded` is read-only; we use a
// configurable accessor here so tests can flip it.
function fakeResponse(): Response & { setEnded: (v: boolean) => void } {
  const ee = new EventEmitter();
  let ended = false;
  const res = Object.assign(ee, {
    locals: {} as Record<string, unknown>,
    setEnded(v: boolean) {
      ended = v;
    },
  });
  Object.defineProperty(res, "writableEnded", {
    get: () => ended,
  });
  return res as unknown as Response & { setEnded: (v: boolean) => void };
}

function runMiddleware(res: Response): void {
  const middleware = RequestAbortController();
  middleware({} as Request, res, (() => undefined) as NextFunction);
}

describe("RequestAbortController", () => {
  test("attaches abortController and abortSignal to response.locals", () => {
    const res = fakeResponse();
    runMiddleware(res);
    expect(res.locals.abortController).toBeInstanceOf(AbortController);
    expect(res.locals.abortSignal).toBeInstanceOf(AbortSignal);
    expect(res.locals.abortSignal.aborted).toBe(false);
  });

  test("does NOT abort on a clean response (finish then close)", () => {
    const res = fakeResponse();
    runMiddleware(res);
    const signal = res.locals.abortSignal;
    res.setEnded(true);
    res.emit("finish");
    res.emit("close");
    expect(signal.aborted).toBe(false);
  });

  test("aborts on close BEFORE finish (client disconnected mid-stream)", () => {
    const res = fakeResponse();
    runMiddleware(res);
    const signal = res.locals.abortSignal;
    res.emit("close");
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(REASON_CLIENT_DISCONNECT);
  });

  test("aborts on response error", () => {
    const res = fakeResponse();
    runMiddleware(res);
    const signal = res.locals.abortSignal;
    const err = new Error("socket-broke");
    res.emit("error", err);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(err);
  });

  test("does NOT abort when close arrives after writableEnded was set (HTTP/1.1 Connection: close)", () => {
    const res = fakeResponse();
    runMiddleware(res);
    const signal = res.locals.abortSignal;
    res.setEnded(true);
    res.emit("close");
    expect(signal.aborted).toBe(false);
  });
});

describe("REASON_CLIENT_DISCONNECT contract", () => {
  test("has stable shape for cross-module identification", () => {
    expect(REASON_CLIENT_DISCONNECT).toBeInstanceOf(DOMException);
    expect(REASON_CLIENT_DISCONNECT.name).toBe("AbortError");
    expect(REASON_CLIENT_DISCONNECT.message).toBe("client closed connection");
  });
});

describe("isClientDisconnect type-guard", () => {
  test("matches the canonical constant", () => {
    expect(isClientDisconnect(REASON_CLIENT_DISCONNECT)).toBe(true);
  });

  test("matches a structurally-equivalent DOMException from a different module instance", () => {
    const other = new DOMException("client closed connection", "AbortError");
    expect(isClientDisconnect(other)).toBe(true);
  });

  test("does not match other AbortErrors", () => {
    const other = new DOMException("user cancelled", "AbortError");
    expect(isClientDisconnect(other)).toBe(false);
  });

  test("does not match non-DOMException values", () => {
    expect(isClientDisconnect(new Error("client closed connection"))).toBe(
      false,
    );
    expect(isClientDisconnect(undefined)).toBe(false);
    expect(isClientDisconnect("client closed connection")).toBe(false);
  });
});
