import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable, Writable } from "node:stream";

import { shortHash } from "@ucp/express/logger.js";

// The CLI is intentionally a plain .mjs script (no TS, no build step) so an
// engineer can run it directly without `npm install`. We exercise it via its
// exported `run()` function so the tests do not depend on spawning a child
// process or on the package being built.
import { run } from "../../../bin/ucp-loghash.mjs";

function makeOutSink() {
  const buf: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      buf.push(String(chunk));
      cb();
    },
  });
  return { stream, text: () => buf.join("") };
}

function tty(): NodeJS.ReadStream {
  // Minimal TTY-like stub so the CLI's stdin-fallback branch is reached
  // only when we explicitly hand it a non-TTY stream.
  return Object.assign(new Readable({ read() {} }), {
    isTTY: true,
  }) as unknown as NodeJS.ReadStream;
}

function pipedStdin(text: string): NodeJS.ReadStream {
  const r = Readable.from([text]);
  return Object.assign(r, { isTTY: false }) as unknown as NodeJS.ReadStream;
}

describe("ucp-loghash CLI", () => {
  test("--raw output is byte-identical to the library shortHash", async () => {
    const stdout = makeOutSink();
    const stderr = makeOutSink();

    const cases = [
      "https://tenant.sharepoint.com/sites/HR/Documents/q4-review.docx?download=1",
      "pageSize=2",
      "search",
      "",
      "null",
      "🦄 unicode",
      "value with spaces",
    ];

    for (const value of cases) {
      stdout.stream.removeAllListeners();
      const fresh = makeOutSink();
      const code = await run(["--raw", value], {
        stdin: tty(),
        stdout: fresh.stream,
        stderr: stderr.stream,
      });
      expect(code).toBe(0);
      expect(fresh.text().trim()).toBe(shortHash(value));
    }
  });

  test("default mode prints hash + opaque token for any value", async () => {
    const stdout = makeOutSink();
    const stderr = makeOutSink();

    const code = await run(["pageSize=2"], {
      stdin: tty(),
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(code).toBe(0);
    const out = stdout.text();
    expect(out).toContain(`hash:   ${shortHash("pageSize=2")}`);
    expect(out).toContain(
      `opaque: [Redacted]#sha256=${shortHash("pageSize=2")}`,
    );
    // pageSize=2 is not a URL — no `url:` line.
    expect(out).not.toContain("url:");
  });

  test("default mode prints url-token form when input is an http/https URL", async () => {
    const stdout = makeOutSink();
    const stderr = makeOutSink();
    const url =
      "https://tenant.sharepoint.com/sites/HR/Documents/q4-review.docx?download=1";

    const code = await run([url], {
      stdin: tty(),
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(code).toBe(0);
    const out = stdout.text();
    expect(out).toContain("url:    https://tenant.sharepoint.com/...#sha256=");

    // The URL-form hash is over pathname + search, NOT the whole URL — same
    // contract as the library's sanitizeValue for URL-shaped inputs.
    const expected = shortHash(
      "/sites/HR/Documents/q4-review.docx?download=1",
    );
    expect(out).toContain(`url:    https://tenant.sharepoint.com/...#sha256=${expected}`);
  });

  test("--raw mode reads from stdin, one hash per line", async () => {
    const stdout = makeOutSink();
    const stderr = makeOutSink();
    const lines = ["alpha", "beta", "gamma"];

    const code = await run(["--raw"], {
      stdin: pipedStdin(lines.join("\n") + "\n"),
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(code).toBe(0);
    const out = stdout.text().trim().split("\n");
    expect(out).toEqual(lines.map(shortHash));
  });

  test("--help prints usage and exits 0", async () => {
    const stdout = makeOutSink();
    const stderr = makeOutSink();
    const code = await run(["--help"], {
      stdin: tty(),
      stdout: stdout.stream,
      stderr: stderr.stream,
    });
    expect(code).toBe(0);
    expect(stdout.text()).toContain("Usage:");
    expect(stdout.text()).toContain("ucp-loghash");
  });

  test("unknown flag prints usage to stderr and returns 2", async () => {
    const stdout = makeOutSink();
    const stderr = makeOutSink();
    const code = await run(["--nope", "value"], {
      stdin: tty(),
      stdout: stdout.stream,
      stderr: stderr.stream,
    });
    expect(code).toBe(2);
    expect(stderr.text()).toContain("unknown flag");
  });

  test("no positional arg and TTY stdin returns 2 with usage on stderr", async () => {
    const stdout = makeOutSink();
    const stderr = makeOutSink();
    const code = await run([], {
      stdin: tty(),
      stdout: stdout.stream,
      stderr: stderr.stream,
    });
    expect(code).toBe(2);
    expect(stderr.text()).toContain("Usage:");
  });

  test("non-http url scheme does not produce a url-form line", async () => {
    const stdout = makeOutSink();
    const stderr = makeOutSink();
    const code = await run(["file:///tmp/test.txt"], {
      stdin: tty(),
      stdout: stdout.stream,
      stderr: stderr.stream,
    });
    expect(code).toBe(0);
    expect(stdout.text()).not.toContain("url:");
  });
});

describe("ucp-loghash CLI — direct invocation", () => {
  // npm publishes a `bin` entry that becomes a symlink in
  // `node_modules/.bin/ucp-loghash`. The CLI's self-execute guard must
  // recognize both the direct path and the symlinked shim as direct
  // invocations, otherwise running it via `npx` or after `npm install -g`
  // silently produces no output.
  const CLI = resolve(__dirname, "../../../bin/ucp-loghash.mjs");
  let tmpDir: string;
  let symlinkPath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ucp-loghash-shim-"));
    symlinkPath = join(tmpDir, "ucp-loghash");
    symlinkSync(CLI, symlinkPath);
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("running the script via its real path prints output", () => {
    const result = spawnSync("node", [CLI, "--raw", "test"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(shortHash("test"));
  });

  test("running the script via a symlink (npm bin shim) also prints output", () => {
    const result = spawnSync("node", [symlinkPath, "--raw", "test"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(shortHash("test"));
  });
});
