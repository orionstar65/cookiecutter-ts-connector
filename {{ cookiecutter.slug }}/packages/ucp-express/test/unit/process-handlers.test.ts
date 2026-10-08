import { describe, expect, test } from "vitest";
import pino from "pino";

import { installProcessHandlers } from "@ucp/express/process-handlers.js";

// We don't test the side-effect (would tear down the test process).
// The contract is: handlers attach to `process` without throwing.

describe("installProcessHandlers", () => {
  test("attaches uncaughtException and unhandledRejection listeners", () => {
    const logger = pino({ enabled: false });

    const before = {
      uncaught: process.listenerCount("uncaughtException"),
      unhandled: process.listenerCount("unhandledRejection"),
    };

    installProcessHandlers(logger);

    const after = {
      uncaught: process.listenerCount("uncaughtException"),
      unhandled: process.listenerCount("unhandledRejection"),
    };

    expect(after.uncaught).toBe(before.uncaught + 1);
    expect(after.unhandled).toBe(before.unhandled + 1);

    // Clean up the listeners we just added so other tests aren't
    // affected.
    const uncaughtListeners = process.listeners("uncaughtException");
    const unhandledListeners = process.listeners("unhandledRejection");
    process.off(
      "uncaughtException",
      uncaughtListeners[uncaughtListeners.length - 1],
    );
    process.off(
      "unhandledRejection",
      unhandledListeners[unhandledListeners.length - 1],
    );
  });
});
