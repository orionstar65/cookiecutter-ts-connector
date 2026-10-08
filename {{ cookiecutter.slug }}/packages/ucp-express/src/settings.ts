import { URL } from "node:url";

import { DefaultAlgorithm, DefaultKeyPath } from "@ucp/express/auth.js";

// ## Types
export enum Environment {
  Development = "development",
  Local = "local",
  Mainline = "mainline",
  Production = "production",
  Sandbox = "sandbox",
}

export interface AppSettings {
  name: string;
  root: URL;
  version?: string;
}

export interface AuthSettings {
  keyPath: string;
  algorithm: string;
}

/**
 * @interface ConnectorSettings
 *
 * Settings common to all connector services. To be applied in a service's
 * settings file as a component.
 *
 * @example
 *
 * ```typescript
 * import settings as connectorSettings, { ConnectorSettings }
 *
 * function getCurrentSettings(env: string) {
 *   return {
 *     connector: connectorSettings,
 *     ...
 *   }
 * }
 *
 * const settings = getCurrentSettings(process.env.NODE_ENV || "local");
 * export default settings;
 * ```
 *
 * @property {number} contentsDefaultPageSize
 *   Max size size of a collection.
 *
 * @property {number} contentsMaxPageSize
 *   Default page size if not specified.
 *
 * @property {string} contentsMaxFileSize
 *   Default is 100MB and overridden by APP_MAX_INGEST_FILE_SIZE
 *
 * @property {number} downloadMaxConcurrency
 *   Default is 50 and overridden by APP_MAX_CONCURRENT_CREATE_CAPTURE
 *
 * @property {number} downloadRetries
 *   The maximum amount of times to retry File Download.
 *   Default is 5 and overridden by APP_FILE_DOWNLOAD_MAX_RETRIES
 *
 * @property {number} downloadRetryDecayFactor
 *   The exponential factor for retry File Download.
 *   Default is 5 and overridden by APP_FILE_DOWNLOAD_EXPONENTIAL_FACTOR
 *
 * @property {number} downloadTimeoutMs
 *   Default is 2 minutes and overridden by APP_FILE_DOWNLOAD_TIMEOUT_SECS
 *
 * @property {number} permissionRetries
 *   The maximum amount of times to retry Document Permission.
 *   Default is 5 and overridden by APP_DOCUMENT_PERMISSION_MAX_RETRIES
 *
 * @property {number} permissionRetryDecayFactor
 *   The exponential factor for retry Document Permission.
 *   Default is 5 and overridden by APP_DOCUMENT_PERMISSION_EXPONENTIAL_FACTOR
 *
 * @property {number} permissionTimeoutMs
 *   The number of milliseconds before starting the first File Download.
 *   Default is 1000 milliseconds and overridden by APP_FILE_DOWNLOAD_MIN_TIMEOUT_MS
 *
 */
export interface ConnectorSettings {
  contentsDefaultPageSize: number;
  contentsMaxPageSize: number;
  contentsMaxFileSize: number;
  downloadMaxConcurrency: number;
  downloadRetries: number;
  downloadRetryDecayFactor: number;
  downloadTimeoutMs: number;
  permissionRetries: number;
  permissionRetryDecayFactor: number;
  permissionTimeoutMs: number;
}

function getConnectorSettings(env: string): ConnectorSettings {
  return {
    contentsDefaultPageSize: parseInt(
      process.env.APP_DEFAULT_PAGE_SIZE ?? "500",
    ),
    contentsMaxPageSize: parseInt(process.env.APP_MAX_PAGE_SIZE ?? "30000"),
    contentsMaxFileSize: parseInt(
      process.env.APP_MAX_INGEST_FILE_SIZE ??
        process.env.APP_MAX_FILE_SIZE ??
        "104857600",
    ),
    downloadMaxConcurrency: parseInt(
      process.env.APP_MAX_CONCURRENT_CREATE_CAPTURE ??
        process.env.APP_MAX_CONCURRENT_CAPTURES ??
        "50",
    ),
    downloadRetries: parseInt(
      process.env.APP_FILE_DOWNLOAD_MAX_RETRIES ?? "3",
    ),
    downloadRetryDecayFactor: parseInt(
      process.env.APP_FILE_DOWNLOAD_EXPONENTIAL_FACTOR ?? "1",
    ),
    downloadTimeoutMs: parseInt(
      process.env.APP_FILE_DOWNLOAD_MIN_TIMEOUT_MS ?? "1000",
    ),
    permissionRetries: parseInt(
      process.env.APP_DOCUMENT_PERMISSION_MAX_RETRIES ?? "5",
    ),
    permissionRetryDecayFactor: parseInt(
      process.env.APP_DOCUMENT_PERMISSION_EXPONENTIAL_FACTOR ?? "5",
    ),
    permissionTimeoutMs: parseInt(
      process.env.APP_DOCUMENT_PERMISSION_MIN_TIMEOUT_MS ?? "1000",
    ),
  };
}

export interface LogSettings {
  level: string;
  src: boolean;
}

/**
 * @interface ServerSettings
 *
 * Controls `node:http` server-level timeouts and connection limits.
 * Without explicit values, Node defaults allow unlimited connections and
 * 5-minute request timeouts, causing connection pile-up under contention.
 *
 * @property {number} timeout
 *   Socket inactivity timeout in milliseconds. If a socket has no traffic
 *   for this duration it is destroyed. Prevents stalled connections from
 *   occupying slots indefinitely.
 *   Default: 120 000 (2 minutes). Env: `APP_EXPRESS_SERVER_TIMEOUT_MS`.
 *
 * @property {number} requestTimeout
 *   Maximum time in milliseconds the server will wait for a complete HTTP
 *   request (headers + body) before aborting. Guards against slow-loris
 *   style request stalls.
 *   Default: 60 000 (1 minute). Env: `APP_EXPRESS_SERVER_REQUEST_TIMEOUT_MS`.
 *
 * @property {number} keepAliveTimeout
 *   How long an idle keep-alive connection stays open before the server
 *   closes it. Should be slightly above the load-balancer's idle timeout
 *   (commonly 60 s) to avoid race-condition resets.
 *   Default: 65 000 (65 seconds). Env: `APP_EXPRESS_SERVER_KEEP_ALIVE_TIMEOUT_MS`.
 *
 * @property {number} maxConnections
 *   Maximum number of concurrent TCP connections the server will accept.
 *   Connections beyond this limit are refused at the OS level, providing
 *   back-pressure instead of unbounded growth.
 *   Default: 1024. Env: `APP_EXPRESS_SERVER_MAX_CONNECTIONS`.
 */
export interface ServerSettings {
  timeout: number;
  requestTimeout: number;
  keepAliveTimeout: number;
  maxConnections: number;
}

export interface ExpressSettings extends AppSettings {
  env: string;
  dev: boolean;
  log: LogSettings;
  server: ServerSettings;

  access?: AppSettings;
  auth?: AuthSettings;
  connector?: ConnectorSettings;
}

// ## Utilities
function isLocal(env: Environment): boolean {
  return env === Environment.Local;
}

function isDev(env: Environment): boolean {
  return (
    isLocal(env) ||
    env === Environment.Development ||
    env === Environment.Mainline ||
    env === Environment.Sandbox
  );
}

function hostname(basename: string, env: Environment): string {
  if (isLocal(env)) return `localhost`;

  return (
    process.env.HOST ??
    process.env.APP_REST_LISTEN_HOST ??
    `${basename}.ucp.svc.cluster.local`
  );
}

const VALID_LOG_LEVELS = new Set([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
]);

function loglevel(): string {
  const level = process.env.APP_LOG_LEVEL ?? "info";
  return VALID_LOG_LEVELS.has(level) ? level : "info";
}

// TODO: Finish settings validation and figure out where to put
function validateSettings(settings: ExpressSettings) {
  const errors: Error[] = [];

  if (errors.length) throw new Error(errors.map((e) => e.message).join("\n"));
}

// ## Constructor
export function getCurrentSettings(check: boolean = false): ExpressSettings {
  // Get the base app settings from process.env, with defaults.
  const env = process.env.NODE_ENV ?? Environment.Local;
  const dev = isDev(env as Environment);
  const version = process.env.APP_VERSION ?? "";
  const name =
    process.env.BITBUCKET_REPO ??
    process.env.GIT_REPO ??
    process.env.APP_SERVICE_NAME ??
    "main";

  // Get the root URL for the service from the environment.
  const proto = isLocal(env as Environment) ? "http" : "https";
  const host = hostname(name, env as Environment);
  const port = parseInt(
    process.env.PORT ?? process.env.APP_REST_LISTEN_PORT ?? "8080",
  );

  const root = new URL(`${proto}://${host}:${port.toString()}/${version}`);

  // Get the auth settings from the environment
  const auth: AuthSettings = {
    keyPath: process.env.APP_CRYPTO ?? DefaultKeyPath,
    algorithm: process.env.APP_CRYPTO_ALG ?? DefaultAlgorithm,
  };

  // Get access service settings from environment.
  const access: AppSettings = {
    name: "access-service",
    version: process.env.APP_ACC_VERSION ?? "v1",
    root: new URL(
      process.env.APP_ACC_HOSTPORT ??
        process.env.INT_ACCESS_SERVICE_HOST ??
        "https://ext-access.ucp.svc.cluster.local:8082",
    ),
  };

  const connector: ConnectorSettings = getConnectorSettings(env);

  // Get server-level timeout and connection limit settings from environment.
  const server: ServerSettings = {
    timeout: Number(process.env.APP_EXPRESS_SERVER_TIMEOUT_MS ?? 120_000),
    requestTimeout: Number(
      process.env.APP_EXPRESS_SERVER_REQUEST_TIMEOUT_MS ?? 60_000,
    ),
    keepAliveTimeout: Number(
      process.env.APP_EXPRESS_SERVER_KEEP_ALIVE_TIMEOUT_MS ?? 65_000,
    ),
    maxConnections: Number(
      process.env.APP_EXPRESS_SERVER_MAX_CONNECTIONS ?? 1024,
    ),
  };

  // Get log settings from environment.
  const log: LogSettings = {
    level: loglevel(),
    src: Boolean(parseInt(process.env.APP_LOG_SRC ?? "0")) || dev || false,
  };

  // Structure up the settings.
  const settings = {
    name,
    root,
    version,
    env,
    dev,
    log,
    server,
    access,
    auth,
    connector,
  };
  if (check) validateSettings(settings);
  return settings;
}

const env = getCurrentSettings();
export default env;
