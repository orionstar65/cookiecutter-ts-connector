#!/usr/bin/env node

// ucp-loghash — recompute the sanitized log hash for a value so you can
// find the corresponding entries in production logs without ever putting a
// raw tenant URL through your search tool.
//
// The hash format here is intentionally identical to the @ucp/express
// logger's `shortHash` helper (`src/logger.ts`). If the library format
// changes, change it here too — the parity test in
// `test/unit/bin/ucp-loghash.test.ts` will fail loudly if they drift.

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

const HASH_LENGTH = 12;

function shortHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, HASH_LENGTH);
}

function sanitizeAsUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.origin}/...#sha256=${shortHash(url.pathname + url.search)}`;
  } catch {
    return null;
  }
}

const USAGE = `Usage:
  ucp-loghash [--raw] <value>
  <pipeline> | ucp-loghash [--raw]
  ucp-loghash --help

Compute the @ucp/express log-sanitization hash for a value so you can
grep production logs for the entries that contain it.

Without --raw, prints up to three forms:
  hash    — the bare 12-hex SHA-256 prefix
  opaque  — \`[Redacted]#sha256=<hex>\`, the token used for non-URL values
  url     — \`<origin>/...#sha256=<hex>\`, the token used for URL-shaped
            values (only printed when the input parses as http/https)

With --raw, prints only the 12-hex hash — one per line — suitable for
piping into shell tools.

When given no positional argument, reads values from stdin, one per line.

Examples:
  # Find access-log entries that mention a known SharePoint URL.
  ucp-loghash 'https://tenant.sharepoint.com/sites/HR/Documents/q4-review.docx'

  # Hash a batch of URLs from a file and grep a log dump.
  ucp-loghash --raw < urls.txt | xargs -I{} grep '{}' production.log

  # Confirm a hash in a log line matches a candidate value.
  ucp-loghash --raw 'pageSize=2'
`;

function printAllForms(value, out) {
  out.write(`hash:   ${shortHash(value)}\n`);
  out.write(`opaque: [Redacted]#sha256=${shortHash(value)}\n`);
  const urlForm = sanitizeAsUrl(value);
  if (urlForm) out.write(`url:    ${urlForm}\n`);
}

async function readStdin(stream) {
  if (stream.isTTY) return null;
  const parts = [];
  for await (const chunk of stream) {
    parts.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  }
  return parts.join("");
}

export async function run(argv, { stdin, stdout, stderr } = {}) {
  const out = stdout ?? process.stdout;
  const err = stderr ?? process.stderr;
  const inStream = stdin ?? process.stdin;

  let raw = false;
  const positional = [];
  for (const a of argv) {
    if (a === "--help" || a === "-h" || a === "-?") {
      out.write(USAGE);
      return 0;
    }
    if (a === "--raw") {
      raw = true;
      continue;
    }
    if (a.startsWith("--")) {
      err.write(`ucp-loghash: unknown flag: ${a}\n`);
      err.write(USAGE);
      return 2;
    }
    positional.push(a);
  }

  if (positional.length > 0) {
    const value = positional.join(" ");
    if (raw) {
      out.write(`${shortHash(value)}\n`);
    } else {
      printAllForms(value, out);
    }
    return 0;
  }

  const piped = await readStdin(inStream);
  if (piped === null || piped.length === 0) {
    err.write(USAGE);
    return 2;
  }

  const lines = piped.split(/\r?\n/).filter((line) => line.length > 0);
  if (raw) {
    for (const line of lines) out.write(`${shortHash(line)}\n`);
  } else {
    for (const [index, line] of lines.entries()) {
      printAllForms(line, out);
      if (index < lines.length - 1) out.write("\n");
    }
  }
  return 0;
}

// Detect direct invocation. `process.argv[1]` is the path the user ran
// (often a symlink inside `node_modules/.bin/`), while `import.meta.url`
// resolves to the real file. We compare via `realpathSync` so both
// `./bin/ucp-loghash.mjs ...` and `node_modules/.bin/ucp-loghash ...`
// (the standard npm bin shim) are recognized as direct invocations.
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  run(process.argv.slice(2)).then(
    (code) => {
      if (code !== 0) process.exit(code);
    },
    (e) => {
      process.stderr.write(`ucp-loghash: ${e?.message ?? e}\n`);
      process.exit(1);
    },
  );
}
