import { Request, Response, NextFunction } from "express";

export type ErrorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) => void;

export type RouteHandler = (
  req: Request,
  res: Response,
) => void | Promise<void>;

export type MiddlewareHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;
