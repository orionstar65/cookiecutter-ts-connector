/**
 * Unit tests for `pipeStreamToResponse` and `formatErrorBody`.
 *
 * The helper is mounted behind a tiny Express route + supertest so the
 * pipe + error-timing behavior is provable deterministically with no
 * network. Each test is written to BITE: it fails if the corresponding
 * guard (pre-headers 500, post-headers destroy, abort-suppression, or
 * source teardown) is removed.
 */
import { describe, expect, test } from "vitest";
import express from "express";
import createError from "http-errors";
import request from "supertest";
import { Readable } from "node:stream";
import { ReasonPhrases, StatusCodes } from "http-status-codes";

import { pipeStreamToResponse } from "@ucp/express/stream.js";
import { formatErrorBody } from "@ucp/express/middleware/ErrorHandlerMiddleware.js";
import { REASON_CLIENT_DISCONNECT } from "@ucp/express/middleware/RequestAbortController.js";
import type { ExpressSettings } from "@ucp/express/settings.js";

const PAYLOAD = "the quick brown fox jumps over the lazy dog";

/**
 * Mount the helper behind a GET route. The test supplies the source
 * stream and (optionally) an abort signal; a `setStatus` flag lets a
 * test stage a non-default status before the pipe, and the route exposes
 * the source via the returned handle so the test can assert teardown.
 */
function makeApp(opts: {
  makeSource: () => Readable;
  signal?: AbortSignal;
  status?: number;
  contentType?: string;
}) {
  const handle: { source?: Readable } = {};
  const app = express();
  app.get("/download", (_req, res) => {
    const source = opts.makeSource();
    handle.source = source;
    if (opts.contentType) res.setHeader("Content-Type", opts.contentType);
    res.status(opts.status ?? StatusCodes.OK);
    void pipeStreamToResponse(res, source, { signal: opts.signal });
  });
  return { app, handle };
}

// Poll until a predicate holds or a deadline passes. Teardown of the
// source happens asynchronously in the helper's `finally`, slightly
// after supertest's response promise settles.
async function waitFor(pred: () => boolean, ms = 1000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) return;
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("pipeStreamToResponse", () => {
  test("happy path: pipes bytes verbatim and honors staged status", async () => {
    const { app, handle } = makeApp({
      makeSource: () => Readable.from(Buffer.from(PAYLOAD)),
      status: StatusCodes.ACCEPTED, // 202 — proves caller-staged status is honored
      contentType: "text/plain",
    });

    const res = await request(app).get("/download");

    expect(res.status).toBe(StatusCodes.ACCEPTED);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toBe(PAYLOAD);
    await waitFor(() => handle.source?.destroyed === true);
    expect(handle.source?.destroyed).toBe(true);
  });

  test("source error BEFORE first byte → clean 500 with formatErrorBody shape", async () => {
    const { app, handle } = makeApp({
      makeSource: () =>
        new Readable({
          read() {
            this.destroy(new Error("upstream tore down pre-headers"));
          },
        }),
    });

    const res = await request(app).get("/download");

    // A bare formatErrorBody-shaped 500 — not a hang, not a reset.
    expect(res.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
    expect(res.body).toMatchObject({
      message: "Something Broke",
      status: StatusCodes.INTERNAL_SERVER_ERROR,
      reason: ReasonPhrases.INTERNAL_SERVER_ERROR,
    });
    await waitFor(() => handle.source?.destroyed === true);
    expect(handle.source?.destroyed).toBe(true);
  });

  test("source error AFTER first byte → truncated response, no second send, source destroyed", async () => {
    // Deterministic post-headers error: push one chunk on the first
    // `read()` (which commits the 200 + headers), then error on the
    // *second* pull — by which point `headersSent` is true, so the
    // helper's pre-headers 500 guard must NOT fire (no second send /
    // ERR_HTTP_HEADERS_SENT), and the response is destroyed/truncated.
    let pulls = 0;
    // Record any attempt to write a status AFTER headers commit — that is
    // the ERR_HTTP_HEADERS_SENT double-send the helper must avoid.
    let secondSend = false;
    const handle: { source?: Readable } = {};
    const app = express();
    app.get("/download", (_req, res) => {
      const origStatus = res.status.bind(res);
      res.status = ((code: number) => {
        if (res.headersSent) secondSend = true;
        return origStatus(code);
      }) as typeof res.status;

      const source = new Readable({
        read() {
          pulls += 1;
          if (pulls === 1) {
            this.push(Buffer.from(PAYLOAD));
          } else {
            this.destroy(new Error("mid-stream boom"));
          }
        },
      });
      handle.source = source;
      res.status(StatusCodes.OK);
      void pipeStreamToResponse(res, source);
    });

    // Once headers commit at 200, a mid-stream error destroys the
    // response. supertest sees either a rejection (socket destroyed) or a
    // truncated 200 body — never a JSON 500 written over the bytes (which
    // would throw ERR_HTTP_HEADERS_SENT). Assert no clean 500 surfaced.
    let status: number | undefined;
    let threw = false;
    try {
      const res = await request(app).get("/download");
      status = res.status;
    } catch {
      threw = true;
    }

    // No re-send of a 500 body: either the socket was torn down (threw),
    // or the status stayed at the already-committed 200.
    expect(threw || status === StatusCodes.OK).toBe(true);
    expect(status).not.toBe(StatusCodes.INTERNAL_SERVER_ERROR);
    expect(secondSend).toBe(false);
    await waitFor(() => handle.source?.destroyed === true);
    expect(handle.source?.destroyed).toBe(true);
  });

  test("client disconnect mid-stream → no 500, returns quietly, source destroyed", async () => {
    const controller = new AbortController();
    let statusSent: number | undefined;

    const app = express();
    const handle: { source?: Readable } = {};
    app.get("/download", (_req, res) => {
      // Capture any status the helper attempts to write — for a benign
      // disconnect it must write NONE.
      const origStatus = res.status.bind(res);
      res.status = ((code: number) => {
        statusSent = code;
        return origStatus(code);
      }) as typeof res.status;

      let pushed = false;
      const source = new Readable({
        read() {
          if (!pushed) {
            pushed = true;
            this.push(Buffer.from(PAYLOAD));
            // Abort with a client-disconnect reason once bytes are flowing.
            setImmediate(() => controller.abort(REASON_CLIENT_DISCONNECT));
          }
          // Never ends on its own — completion depends on the abort.
        },
      });
      handle.source = source;
      res.status(StatusCodes.OK);
      statusSent = undefined; // ignore the staged 200; we assert no 500 after
      void pipeStreamToResponse(res, source, { signal: controller.signal });
    });

    // The destroyed socket rejects the supertest promise.
    await expect(request(app).get("/download")).rejects.toThrow();

    // The benign-disconnect branch must NOT have written a 500.
    expect(statusSent).not.toBe(StatusCodes.INTERNAL_SERVER_ERROR);
    await waitFor(() => handle.source?.destroyed === true);
    expect(handle.source?.destroyed).toBe(true);
  });

  test("disconnect BEFORE first byte → guard must NOT fire a 500", async () => {
    // Signal already aborted with a client-disconnect reason; the source
    // then errors before any byte. The `!signal.aborted` guard must
    // suppress the pre-headers 500 (you don't write to a dying socket).
    const controller = new AbortController();
    controller.abort(REASON_CLIENT_DISCONNECT);

    let statusSent: number | undefined;
    const app = express();
    const handle: { source?: Readable } = {};
    app.get("/download", (_req, res) => {
      res.status = ((code: number) => {
        statusSent = code;
        return res;
      }) as typeof res.status;
      const source = new Readable({
        read() {
          this.destroy(new Error("source error during pre-headers abort"));
        },
      });
      handle.source = source;
      void pipeStreamToResponse(res, source, { signal: controller.signal });
    });

    // The request settles (rejects or returns) but no 500 is ever staged.
    try {
      await request(app).get("/download");
    } catch {
      /* socket torn down — expected, irrelevant to the assertion */
    }

    expect(statusSent).toBeUndefined();
    await waitFor(() => handle.source?.destroyed === true);
    expect(handle.source?.destroyed).toBe(true);
  });

  test("no signal: happy path resolves cleanly without destroying the response on error", async () => {
    // Regression bite for the `pipeline(source, res, undefined)` trap.
    // `stream/promises.pipeline` reads every trailing arg as a stream
    // stage, so a literal `undefined` third arg makes the promise reject
    // with ERR_INVALID_ARG_TYPE *after* the bytes already flushed — which
    // drove the helper into its post-headers `response.destroy(error)`
    // branch on a fully successful download. Assert the helper's promise
    // resolves and `response.destroy` is NOT called with an error.
    let pipeRejected = false;
    let destroyedWithError = false;
    const handle: { source?: Readable } = {};
    const app = express();
    app.get("/download", (_req, res) => {
      const origDestroy = res.destroy.bind(res);
      res.destroy = ((err?: Error) => {
        if (err) destroyedWithError = true;
        return origDestroy(err);
      }) as typeof res.destroy;

      const source = Readable.from(Buffer.from(PAYLOAD));
      handle.source = source;
      res.status(StatusCodes.OK);
      // No `signal` — exercises the `signal ? { signal } : {}` branch.
      void pipeStreamToResponse(res, source).catch(() => {
        pipeRejected = true;
      });
    });

    const res = await request(app).get("/download");

    expect(res.status).toBe(StatusCodes.OK);
    expect(res.text).toBe(PAYLOAD);
    // The helper must not surface a rejection on a clean download...
    expect(pipeRejected).toBe(false);
    // ...nor tear the completed response down with a (spurious) error.
    expect(destroyedWithError).toBe(false);
    await waitFor(() => handle.source?.destroyed === true);
    expect(handle.source?.destroyed).toBe(true);
  });

  test("pre-headers 500 uses the passed settings (dev stack) over ambient env", async () => {
    // The early-error 500 must be formatted with the SAME settings the
    // Server/terminal handler use, not a fresh getCurrentSettings() read.
    // Force `dev: true` via the option and assert the dev-only `stack`
    // appears even though the ambient NODE_ENV ("test") is not dev — this
    // bites if the helper reverts to reading settings from env.
    const devSettings: ExpressSettings = {
      name: "test",
      env: "production",
      dev: true,
      root: new URL("http://localhost:9999"),
      log: { level: "fatal", src: false },
      server: {
        timeout: 120_000,
        requestTimeout: 60_000,
        keepAliveTimeout: 65_000,
        maxConnections: 1024,
      },
    };
    const app = express();
    app.get("/download", (_req, res) => {
      const source = new Readable({
        read() {
          this.destroy(new Error("pre-headers boom"));
        },
      });
      res.status(StatusCodes.OK);
      void pipeStreamToResponse(res, source, { settings: devSettings });
    });

    const res = await request(app).get("/download");

    expect(res.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
    expect(res.body).toMatchObject({
      message: "Something Broke",
      status: StatusCodes.INTERNAL_SERVER_ERROR,
    });
    expect(typeof res.body.stack).toBe("string");
    expect(res.body.stack).toContain("pre-headers boom");
  });
});

describe("formatErrorBody", () => {
  const base: ExpressSettings = {
    name: "test",
    env: "test",
    dev: false,
    root: new URL("http://localhost:9999"),
    log: { level: "fatal", src: false },
    server: {
      timeout: 120_000,
      requestTimeout: 60_000,
      keepAliveTimeout: 65_000,
      maxConnections: 1024,
    },
  };

  test("HttpError maps to its status, message, and reason", () => {
    const err = createError(StatusCodes.NOT_FOUND, "not here");
    const body = formatErrorBody(err, base);
    expect(body).toEqual({
      message: "not here",
      status: StatusCodes.NOT_FOUND,
      reason: ReasonPhrases.NOT_FOUND,
    });
  });

  test("generic Error collapses to a 500 'Something Broke'", () => {
    const body = formatErrorBody(new Error("anything"), base);
    expect(body).toEqual({
      message: "Something Broke",
      status: StatusCodes.INTERNAL_SERVER_ERROR,
      reason: ReasonPhrases.INTERNAL_SERVER_ERROR,
    });
    // No stack outside dev — biting check.
    expect(body.stack).toBeUndefined();
  });

  test("dev mode includes the raw stack", () => {
    const err = new Error("boom");
    const body = formatErrorBody(err, { ...base, dev: true });
    expect(body.stack).toBeDefined();
    expect(body.stack).toBe(err.stack);
  });
});
