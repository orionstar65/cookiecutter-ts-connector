import AuthenticationMiddleware from "@ucp/express/middleware/AuthenticationMiddleware.js";
import ConcurrencyLimitMiddleware from "@ucp/express/middleware/ConcurrencyLimitMiddleware.js";
import ErrorHandlerMiddleware from "@ucp/express/middleware/ErrorHandlerMiddleware.js";
import LocalAccessMiddleware from "@ucp/express/middleware/LocalAccessMiddleware.js";
import LoggingMiddleware from "@ucp/express/middleware/LoggingMiddleware.js";
import MetricsMiddleware from "@ucp/express/middleware/MetricsMiddleware.js";
import RemoteAccessMiddleware from "@ucp/express/middleware/RemoteAccessMiddleware.js";
import RequestAbortController from "@ucp/express/middleware/RequestAbortController.js";
import ResponseMetadata from "@ucp/express/middleware/ResponseMetadata.js";
import ValidationMiddleware from "@ucp/express/middleware/ValidationMiddleware.js";

export {
  REASON_CLIENT_DISCONNECT,
  isClientDisconnect,
} from "@ucp/express/middleware/RequestAbortController.js";

// ! DEPRECATED: Backwards-compatibility exports
export const Authenticated = AuthenticationMiddleware;
export const StandardErrorHandler = ErrorHandlerMiddleware;
export const StandardLogging = LoggingMiddleware;
export const AccessServiceAuth = RemoteAccessMiddleware;
export const LocalAuth = LocalAccessMiddleware;
export const validate = ValidationMiddleware;

export {
  AuthenticationMiddleware,
  ConcurrencyLimitMiddleware,
  ErrorHandlerMiddleware,
  LoggingMiddleware,
  RemoteAccessMiddleware,
  LocalAccessMiddleware,
  MetricsMiddleware,
  RequestAbortController,
  ResponseMetadata,
  ValidationMiddleware,
};
