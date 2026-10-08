import * as http from "http";
import * as uuid from "uuid";

import pino from "pino";
import cors from "cors";
import express, { Express, Request, Response } from "express";
import { ReasonPhrases, StatusCodes } from "http-status-codes";
import prometheus from "prom-client";

import Logger from "@ucp/express/logger.js";
import * as middleware from "@ucp/express/middleware/index.js";
import { installProcessHandlers } from "@ucp/express/process-handlers.js";
import currentSettings, { ExpressSettings } from "@ucp/express/settings.js";

/**
 * Default histogram buckets (in seconds) tuned for typical connector workloads.
 *
 * The bucket boundaries let you derive SLO burn rates at common thresholds:
 *   - p50 latency  → 0.1–0.25 s range
 *   - p90 latency  → 0.5–1 s range
 *   - p99 latency  → 2.5–10 s range
 *   - long-tail     → 30–120 s (large file downloads)
 */
const DEFAULT_DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120,
];

/**
 * `configureDefaultRoutes` adds a `Home`, `Not Found`, and `Health Check`
 * endpoints to the app.
 *
 * @param {Express} app is the express instance to which wea dd the default routes
 */
export function configureHealthChecks(app: Express, settings: ExpressSettings) {
  // HOME
  app.get("/", (request: Request, response: Response) => {
    response
      .status(200)
      .json({
        code: StatusCodes.OK,
        status: ReasonPhrases.OK,
        time: Date.now(),
        message: `Hello, from ${request.url}.`,
      });
  });

  // ## Health Checks
  // A service is alive if it's up and able to respond.
  app.get("/alive", alive);
  function alive(request: Request, response: Response) {
    response
      .status(200)
      .json({
        code: StatusCodes.OK,
        status: ReasonPhrases.OK,
        time: Date.now(),
      });
  }

  // A service is ready if it's up, able to respond, and marked ready.
  // A service is ready if dependent services are alive and ready. ( Optional )
  app.get("/ready", ready);
  function ready(request: Request, response: Response) {
    request.app.locals.ready
      ? response
          .status(StatusCodes.OK)
          .json({
            code: StatusCodes.OK,
            message: ReasonPhrases.OK,
            time: Date.now(),
          })
      : response
          .status(StatusCodes.SERVICE_UNAVAILABLE)
          .json({
            code: StatusCodes.SERVICE_UNAVAILABLE,
            error: ReasonPhrases.SERVICE_UNAVAILABLE,
            time: Date.now(),
          });
  }
}

export function configureMetrics(app: Express, settings: ExpressSettings) {
  // Label all metrics with the (host, environment, version) of the app.
  const labels = {
    host: settings.root.hostname,
    env: settings.env,
    version: settings.version,
  };

  // Include all default metrics
  prometheus.collectDefaultMetrics({ labels });

  // Include a default "up" metric
  const up = new prometheus.Gauge({
    name: "up",
    help: "1 = up, 0 = not up",
    labelNames: Object.keys(labels),
  });

  up.set(labels, 1);

  // A service is healthy if its internal process stats are healthy.
  app.get("/metrics", metrics);
  async function metrics(request: Request, response: Response) {
    try {
      response.set("Content-Type", prometheus.register.contentType);
      response.end(await prometheus.register.metrics());
    } catch (err) {
      response.status(500).end(err);
    }
  }
}

function configureDefaultMiddleware(app: Express, settings: ExpressSettings) {
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  // Auto-mounted: every connector receives `response.locals.abortSignal`
  // by construction. Connectors that don't read it behave exactly as
  // before; streaming connectors plumb it into fetch/pipeline/etc.
  app.use(middleware.RequestAbortController());
  app.use(middleware.ResponseMetadata());
  app.use(middleware.MetricsMiddleware({ buckets: DEFAULT_DURATION_BUCKETS }));

  // TODO: Turn back on when we figure out helm secrets
  // if (!settings.dev) app.use(middleware.Authenticated());
}

function configureLocals(app: Express, settings: ExpressSettings) {
  const id = uuid.v4().split("-", 1)[0];

  app.locals.id = id;
  app.locals.name = settings.name;
  app.locals.instance = settings.name + "." + id;
  app.locals.startTime = Date.now();
}

interface ExpressServer {
  app: Express;
  logger: pino.Logger;
  start: () => void;
  shutdown: () => void;
}

/**
 * Server configures a base Express app, a standard logger, and a start
 * function.
 *
 * @param {ExpressSettings} settings
 * @returns {Express}
 * @constructor
 */
export default class Server implements ExpressServer {
  settings: ExpressSettings;
  app: Express;
  server?: http.Server;
  logger: pino.Logger;

  constructor(settings: ExpressSettings = currentSettings) {
    this.settings = settings;
    this.logger = Logger(
      settings.name,
      settings.log.level,
      settings.log.src,
      settings.env,
    );

    // Construct a Server
    this.app = express();
    this.app.use(middleware.StandardLogging(this.logger));

    // Configure default routes and middlewares
    configureLocals(this.app, settings);
    configureHealthChecks(this.app, settings);
    configureMetrics(this.app, settings);
    configureDefaultMiddleware(this.app, settings);

    // Bind this server as a singleton to the `start` function
    this.start = this.start.bind(this);
    this.shutdown = this.shutdown.bind(this);
  }

  // Create a closure around the server shutdown
  shutdown() {
    this.app.locals.ready = false;
    this.server!.close(() => {
      this.logger.info("Server closed");
      process.exit(0);
    });

    setTimeout(() => {
      console.error("Forcefully shutdown");
      process.exit(1);
    }, 10000);
  }

  // Return a default start callback for the server
  start(): http.Server {
    // Install process-level safety net BEFORE any user code runs so
    // a crash during init/listen still flushes a structured log
    // line. See `process-handlers.ts` for rationale.
    installProcessHandlers(this.logger);

    this.logger.info(this.settings, "Starting app with settings...");
    this.app.locals.logger = this.logger.child({ context: "app" });

    this.app.use(middleware.StandardErrorHandler(this.settings, this.logger));
    this.server = this.app.listen(this.settings.root.port, () => {
      this.app.locals.ready = true;
      this.logger.info(`Server running at ${this.settings.root.href}`);
    });

    // Apply server-level timeouts and connection limits from settings.
    const { server } = this.settings;
    this.server.timeout = server.timeout;
    this.server.requestTimeout = server.requestTimeout;
    this.server.keepAliveTimeout = server.keepAliveTimeout;
    this.server.maxConnections = server.maxConnections;

    const shutdown = this.shutdown.bind(this);
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    return this.server;
  }
}
