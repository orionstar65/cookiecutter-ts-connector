import { Express } from "express";
import expressListRoutes from "express-list-routes";

import Server from "@ucp/express/index.js";
import { AccessServiceAuth, LocalAuth } from "@ucp/express/middleware.js";
import currentSettings, { Environment } from "@ucp/express/settings.js";

import router from "@{{ cookiecutter.username }}/{{ cookiecutter.slug }}/routes.js";
import pkg from "../package.json" with { type: "json" };

export const { app, start, shutdown } = new Server();

export function init(app: Express) {
  const accessMiddleware =
    currentSettings.env == Environment.Local
      ? LocalAuth()
      : AccessServiceAuth(currentSettings.access);

  app.use(
    "/api/connector/v1alpha1/connectors/:connectorId",
    accessMiddleware,
    router,
  );
}

init(app);
export default app;

if (import.meta.url.endsWith(pkg.module)) {
  start();
  expressListRoutes(app);
}
