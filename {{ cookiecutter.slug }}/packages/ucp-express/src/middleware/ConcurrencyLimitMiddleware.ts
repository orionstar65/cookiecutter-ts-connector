import { Request, Response, NextFunction } from "express";
import HttpError from "http-errors";
import { StatusCodes } from "http-status-codes";

const MIN_RETRY_AFTER_SECONDS = 1;
const MAX_RETRY_AFTER_SECONDS = 10;

export interface ConcurrencyLimits {
  globalMax: number;
  keyMax: number;
}

/**
 * Computes a Retry-After value (in seconds) that scales linearly with the
 * higher of the two saturation ratios (global and per-key). At exactly-full
 * the value is the minimum; as active slots overflow further into queued
 * territory the value climbs toward the maximum.
 *
 *   saturation = max(globalActive / globalMax, keyActive / keyMax)
 *   retryAfter = ceil(MIN + (MAX - MIN) * saturation)
 *
 * Clamped to [MIN_RETRY_AFTER_SECONDS, MAX_RETRY_AFTER_SECONDS].
 */
export type Saturation = ConcurrencyLimits & {
  globalActive: number;
  keyActive: number;
};

/**
 * @function retryAfterSeconds
 *
 * Computes the Retry-After value (in seconds) for HTTP responses indicating
 * clients should retry their requests later due to concurrency limits being
 * reached.
 *
 * The retry time is determined by the higher of two saturation ratios:
 *
 *   - global saturation: current global active count divided by global max count
 *   - key saturation: current active count for a specific key divided by its max
 *
 * The function scales the retry delay linearly within a range from
 * MIN_RETRY_AFTER_SECONDS to MAX_RETRY_AFTER_SECONDS as the saturation increases
 * from 0 to 1 (and beyond). It ensures the result is always clamped to this range.
 *
 * @param {Saturation} props - An object containing the current and maximum active
 * counts globally and per key.
 * @returns The computed Retry-After value, in seconds, for use in HTTP headers.
 */
function retryAfterSeconds(props: Saturation): number {
  const { globalActive, globalMax, keyActive, keyMax } = props;

  // Compute the saturation for the global and key resources.
  const globalSaturation = globalActive / globalMax;
  const keySaturation = keyActive / keyMax;
  const saturation = Math.max(globalSaturation, keySaturation);

  // Scale the Retry-After header within a defined range.
  const range = MAX_RETRY_AFTER_SECONDS - MIN_RETRY_AFTER_SECONDS;
  const seconds = Math.ceil(MIN_RETRY_AFTER_SECONDS + range * saturation);

  // Clamp to the allowed minimum and maximum values.
  const clamped = Math.min(
    Math.max(seconds, MIN_RETRY_AFTER_SECONDS),
    MAX_RETRY_AFTER_SECONDS,
  );

  return clamped;
}

/**
 * @function ConcurrencyLimitMiddleware
 * Middleware that enforces a concurrency limit on the number of concurrent
 * downloads for a given connector.
 *
 * @param {number} props.globalMax - The maximum number of concurrent downloads
 * for all connectors.
 * @param {number} props.keyMax - The maximum number of concurrent downloads for
 * a given connector.
 */
export default function ConcurrencyLimitMiddleware({
  globalMax,
  keyMax,
}: ConcurrencyLimits) {
  let globalActive = 0;
  const perKeyActive = new Map<string, number>();

  return function middleware(
    request: Request,
    response: Response,
    next: NextFunction,
  ) {
    const key = response.locals.connectorId as string;
    const keyActive = perKeyActive.get(key) ?? 0;

    const isOverLimit = globalActive >= globalMax || keyActive >= keyMax;
    if (isOverLimit) {
      const saturation = { globalActive, globalMax, keyActive, keyMax };
      const retryAfter = retryAfterSeconds(saturation);
      response.setHeader("Retry-After", String(retryAfter));
      throw HttpError(
        StatusCodes.TOO_MANY_REQUESTS,
        "Too many concurrent downloads",
      );
    }

    globalActive++;
    perKeyActive.set(key, keyActive + 1);
    response.on("close", () => {
      globalActive--;
      const current = (perKeyActive.get(key) ?? 1) - 1;
      if (current <= 0) perKeyActive.delete(key);
      else perKeyActive.set(key, current);
    });

    next();
  };
}
