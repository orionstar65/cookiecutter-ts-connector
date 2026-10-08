import { createHash } from "node:crypto";
import pino from "pino";
import { Express, Request, Response } from "express";

const DefaultLogLevel = process.env.APP_LOG_LEVEL ?? "info";

export type Severity = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LogEntry {
  level: number;
  time: string;
  msg: string;
  [key: string]: any;
}

/**
 * Map pino numeric levels to StackDriver LogSeverity strings.
 * WARN (40) maps to "WARNING" per StackDriver convention.
 *
 * @see https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#LogSeverity
 */
const levelToSeverity: Record<number, string> = {
  10: "TRACE",
  20: "DEBUG",
  30: "INFO",
  40: "WARNING",
  50: "ERROR",
  60: "FATAL",
};

/**
 * A thin writable destination that adds StackDriver-compatible fields
 * to pino's JSON output:
 *   - `timestamp` (copy of `time`)
 *   - `M` (copy of `msg`)
 *   - `severity` (uppercase level string, WARN → WARNING)
 */
class StackDriverDestination {
  write(record: string): void {
    const entry = JSON.parse(record) as LogEntry;

    entry.timestamp = entry.time;
    entry.M = entry.msg;
    entry.severity =
      levelToSeverity[entry.level] ?? String(entry.level).toUpperCase();

    process.stdout.write(JSON.stringify(entry) + "\n");
  }
}

/**
 * Returns true when query/URL redaction is enabled in the request serializer.
 *
 * Default: enabled. Set `APP_LOG_REDACT_QUERY=false` (or `0`) as an
 * emergency-disable switch when raw query strings are needed for an active
 * incident; restart the process to apply, then unset to re-enable.
 *
 * Deviations from the default are flagged loudly on logger construction
 * (see `warnOnFlagDeviation`) so the operational decision is visible in
 * startup logs and stays short-lived.
 */
function isQueryRedactionEnabled(): boolean {
  const raw = process.env.APP_LOG_REDACT_QUERY;
  return raw !== "false" && raw !== "0";
}

/**
 * Returns true when error-log URL redaction is enabled.
 *
 * Default: disabled. Error-level logs intentionally keep raw URLs from
 * `err.config.url`, `err.response.url`, and stack frames because the URL is
 * load-bearing context for triage of upstream failures. Set
 * `APP_LOG_REDACT_ERR_URLS=true` (or `1`) when a compliance review or
 * customer DPA requires hashing URLs at the error layer too.
 *
 * Enabling this flag costs triage detail. It should be a deliberate
 * compliance choice with explicit justification, not a precaution. Like
 * the query-redaction flag, deviations from the default are warned on
 * logger construction.
 */
function isErrUrlRedactionEnabled(): boolean {
  const raw = process.env.APP_LOG_REDACT_ERR_URLS;
  return raw === "true" || raw === "1";
}

/**
 * Hash a value for log correlation.
 *
 * This is a *correlation primitive*, not a *confidentiality primitive*.
 * The same input always produces the same 12-hex-char output (48 bits),
 * which is enough to correlate identical values across log lines but is
 * trivially reversible for short or low-entropy inputs.
 *
 * Privacy classification: the resulting token is *pseudonymized* data, not
 * *anonymized* data, under GDPR Art. 4(5) and EDPB guidance — a 48-bit
 * truncated hash is recoverable by dictionary attack against a known input
 * space, so retention, access-control, and subject-access obligations
 * continue to apply to the log records that contain it. If a regulatory
 * review requires true anonymization (records that fall outside DPA
 * scope), this primitive is insufficient and the URLs would have to be
 * dropped or replaced with a destroyable keyed HMAC.
 */
export function shortHash(value: unknown): string {
  let serialized: string;
  try {
    serialized =
      typeof value === "string" ? value : JSON.stringify(value ?? null);
  } catch {
    serialized = String(value);
  }
  return createHash("sha256").update(serialized).digest("hex").slice(0, 12);
}

const SHA256_TOKEN_REGEX = /sha256=[a-f0-9]{12}/;
const HTTP_URL_PATTERN = /\bhttps?:\/\/[^\s"'<>)\]]+/g;
const HTTP_URL_ONLY_REGEX = /^https?:\/\/[^\s"'<>)\]]+$/;

/**
 * Single sanitizer used by every log surface in this package — request
 * query/URL redaction AND error-log URL redaction route through this
 * function so operators have one grep pattern (`sha256=[a-f0-9]{12}`) to
 * correlate across both log layers.
 *
 * Output shape varies by input:
 *   - http(s) URL string → `${origin}/...#sha256=<hex>` (origin preserved
 *     for diagnostics; path+search hashed)
 *   - anything else → `[Redacted]#sha256=<hex>` (opaque hash)
 *
 * The origin-preserving form is intentionally more diagnostic for URLs:
 * operators can still see which tenant or service produced the URL while
 * the document/resource identity stays out of logs.
 */
function sanitizeValue(value: unknown): string {
  if (typeof value === "string" && HTTP_URL_ONLY_REGEX.test(value)) {
    try {
      const url = new URL(value);
      return `${url.origin}/...#sha256=${shortHash(url.pathname + url.search)}`;
    } catch {
      // fall through to opaque hash
    }
  }
  return `[Redacted]#sha256=${shortHash(value)}`;
}

/**
 * Recursively redact a query value while preserving its structural shape.
 * Keys survive; leaf values are replaced with a correlation token.
 *
 * Non-plain objects (Date, Map, Buffer, etc.) would otherwise collapse to
 * `{}` under `Object.entries` — they are detected by prototype and hashed
 * as scalars so their value is captured for correlation rather than lost.
 */
function redactQuery(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (Array.isArray(value)) return value.map(redactQuery);
  if (typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      return sanitizeValue(value);
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        redactQuery(nestedValue),
      ]),
    );
  }
  return sanitizeValue(value);
}

/**
 * Redact query-string values inside a request URL.
 *
 * The pathname is intentionally preserved verbatim: UCP connectors do not
 * embed sensitive data in path segments, and operators rely on the pathname
 * for debug and traffic analysis. Callers that route sensitive identifiers
 * through path segments must redact them separately.
 *
 * Defensive against malformed input: unparseable, empty, undefined, or
 * non-string values return a safe representation without throwing. Pino
 * swallows serializer exceptions and would otherwise silently drop the
 * entire `req` field for the affected log line.
 *
 * The redacted token is written unencoded into the query string so the
 * same shape appears in both the `url` and `query` log fields — operators
 * grep for `sha256=` and `URLSearchParams.toString()` would otherwise
 * percent-encode the `[`, `]`, and `#`, producing a mismatch.
 */
function sanitizeRequestUrl(url: unknown): string {
  if (url === undefined || url === null) return "";
  if (typeof url !== "string") {
    return `[non-string-url]#sha256=${shortHash(url)}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(url, "http://localhost");
  } catch {
    return `[unparseable-url]#sha256=${shortHash(url)}`;
  }
  if (!parsed.search) return url;

  const segments: string[] = [];
  parsed.searchParams.forEach((value, key) => {
    segments.push(`${encodeURIComponent(key)}=${sanitizeValue(value)}`);
  });
  return `${parsed.pathname}?${segments.join("&")}`;
}

/**
 * Replace http(s) URLs inside a free-text string (typically an error
 * message or a stack frame) with the unified sanitized form.
 *
 * Scheme handling: we deliberately match only `https?:` and ignore
 * `file://`, `data:`, `chrome-extension:`, etc. Stack frames in V8
 * include `file:///path/to/source.js` URIs for every frame — those are
 * source code paths needed for triage, not tenant data, so scrubbing
 * them would obliterate stack context. The exclusion is by design and
 * should not be widened without evaluating the source-path trade-off.
 *
 * False-positive risk: any substring that *looks* like an http(s) URL
 * gets scrubbed, including user-content strings that incidentally
 * contain URL-shaped text. For UCP connectors this is the desirable
 * outcome (the false positive is typically tenant data anyway); other
 * consumers should be aware that the regex is intentionally broad.
 */
function sanitizeUrlsInText(text: string): string {
  return text.replace(HTTP_URL_PATTERN, (match) => {
    // Idempotency guard: a string already carrying the unified token
    // shape (`${origin}/...#sha256=<hex>`) re-matches the URL pattern;
    // skip it so a second pass through this function is a no-op.
    if (SHA256_TOKEN_REGEX.test(match)) return match;
    try {
      const url = new URL(match);
      return `${url.origin}/...#sha256=${shortHash(url.pathname + url.search)}`;
    } catch {
      return `[redacted-url]#sha256=${shortHash(match)}`;
    }
  });
}

/**
 * Walk a serialized-error object and apply `sanitizeUrlsInText` to every
 * string leaf, recursing into arrays and nested objects. Used by
 * `errSerializer` when the err-redaction flag is on.
 *
 * Object-walk policy: `pino.stdSerializers.err` returns an object whose
 * prototype is NOT `Object.prototype` (it has a hidden raw-error symbol
 * attached), so we cannot use the strict prototype check that
 * `redactQuery` uses. Inside an error payload, leaf values are almost
 * always primitives or plain objects; the loose walk is appropriate.
 */
function sanitizeErrValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeUrlsInText(value);
  if (Array.isArray(value)) return value.map(sanitizeErrValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, sanitizeErrValue(v)]),
    );
  }
  return value;
}

/**
 * Wrap `pino.stdSerializers.err` so callers get URL-sanitized errors
 * when `APP_LOG_REDACT_ERR_URLS` is enabled. When the flag is off
 * (the default), this is byte-identical to the upstream serializer.
 */
function errSerializer(err: Error): unknown {
  const result = pino.stdSerializers.err(err);
  return isErrUrlRedactionEnabled() ? sanitizeErrValue(result) : result;
}

/**
 * Sanitize a stack string copied outside the err serializer pipeline
 * (notably `body.stack` in `ErrorHandlerMiddleware`). Gated on the same
 * flag as `errSerializer` so the two stay consistent.
 */
export function sanitizeStackForLog(
  stack: string | undefined,
): string | undefined {
  if (stack === undefined) return undefined;
  if (!isErrUrlRedactionEnabled()) return stack;
  return sanitizeUrlsInText(stack);
}

let flagDeviationWarned = false;

/**
 * Emit a single warn line if either redaction flag is set to a
 * non-default value at logger construction. This is intentional
 * governance: deviations should be short-lived with explicit
 * justification, and the warn line gives ops a visible breadcrumb so
 * the deviation is not silent.
 */
function warnOnFlagDeviation(log: pino.Logger): void {
  if (flagDeviationWarned) return;
  flagDeviationWarned = true;

  if (!isQueryRedactionEnabled()) {
    log.warn(
      {
        flag: "APP_LOG_REDACT_QUERY",
        value: process.env.APP_LOG_REDACT_QUERY,
        default: "enabled",
      },
      "request-log query redaction is DISABLED — raw query strings will appear in access logs; intended for short-lived incident response only",
    );
  }
  if (isErrUrlRedactionEnabled()) {
    log.warn(
      {
        flag: "APP_LOG_REDACT_ERR_URLS",
        value: process.env.APP_LOG_REDACT_ERR_URLS,
        default: "disabled",
      },
      "error-log URL redaction is ENABLED — URLs in err.config.url, err.response.url, and stack frames will be hashed at the cost of triage detail; should be a deliberate compliance choice with explicit justification",
    );
  }
}

/**
 * Convert the Request object into its logging representation.
 * @see https://github.com/trentm/node-bunyan?tab=readme-ov-file#serializers
 *
 * @param {Request} request Express request to serialize
 * @returns {object} serialized request
 */
export function requestSerializer(request?: Request) {
  if (!request) return null;

  const { headers } = request;
  const redact = isQueryRedactionEnabled();
  return {
    id: headers["x-request-id"],
    method: request.method,
    url: redact ? sanitizeRequestUrl(request.url) : request.url,
    hostname: request.hostname,
    query: redact ? redactQuery(request.query) : request.query,
    headers: headers,
    httpVersion: request.httpVersion,
    clientIp: request.ip,
  };
}

/**
 * Convert the Request object into its logging representation.
 * @see https://github.com/trentm/node-bunyan?tab=readme-ov-file#serializers
 *
 * @param {Response} response Express Response to serialize
 * @returns {object} serialized Response
 */
export function responseSerializer(response?: Response) {
  if (!response) return null;

  return {
    statusCode: response.statusCode,
    contentType: response.get("content-type"),
    size: response.get("content-length"),
    headers: response.getHeaders(),
  };
}

/**
 * Header paths redacted from log output to prevent sensitive credentials
 * from being persisted in logs or forwarded to StackDriver.
 *
 * Do not add `req.url` or `req.query` here — they are sanitized inside
 * `requestSerializer` to preserve a correlation hash. Pino's literal
 * `[Redacted]` replacement would overwrite the hash and lose the signal.
 *
 * @see https://getpino.io/#/docs/redaction
 */
const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['set-cookie']",
  "req.headers['proxy-authorization']",
  "req.headers['x-api-key']",
  "res.headers['set-cookie']",
];

/**
 * Construct a pino logger with standard UCP configuration.
 *
 * @param {string} name    Logger name (appears in every log entry)
 * @param {string} level   Minimum log level
 * @param {boolean} _src   Accepted for API compatibility; ignored (pino has no built-in caller info)
 * @param {string} env     Environment label injected into every log entry
 * @return {pino.Logger}
 */
export default function (
  name: string,
  level: string = DefaultLogLevel,
  _src: boolean = false,
  env: string = process.env.NODE_ENV ?? "local",
): pino.Logger {
  const log = pino(
    {
      name: name,
      level: level,
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: REDACT_PATHS,
      serializers: {
        app: (app: Express) => app.locals,
        req: requestSerializer,
        res: responseSerializer,
        err: errSerializer,
      },
      mixin() {
        return { env };
      },
    },
    new StackDriverDestination(),
  );
  warnOnFlagDeviation(log);
  return log;
}

/**
 * Test-only helper: reset the once-per-process flag-deviation warn so a
 * test can exercise the warn-on-construction path repeatedly. Not exported
 * from the public package entry point.
 */
export function _resetFlagDeviationWarnedForTests(): void {
  flagDeviationWarned = false;
}
