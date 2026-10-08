import { describe, expect, test } from "vitest";

import { ReasonPhrases, StatusCodes } from "http-status-codes";
import {
  ContentRangeHeader,
  RangeHeader,
  Range,
  rangeToSpan,
} from "@ucp/express/utils.js";

describe("utils", () => {
  describe("ContentRangeHeader", () => {
    describe.each([
      {
        case: "closed interval with size",
        header: "bytes 0-10/10",
        range: { unit: "bytes", start: 0, end: 10, size: 10 } as Range,
      },
      {
        case: "closed interval with *",
        header: "bytes 0-10/*",
        range: { unit: "bytes", start: 0, end: 10, size: Infinity } as Range,
      },
    ])("$case", ({ header, range }) => {
      test("should parse", () => {
        const check = ContentRangeHeader.parse(header);
        expect(check).toStrictEqual(range);
      });

      test("should render", () => {
        const check = ContentRangeHeader.render(range);
        expect(check).toStrictEqual(header);
      });
    });

    test("render returns unsatisfiable string when start/end are NaN", () => {
      expect(
        ContentRangeHeader.render({
          unit: "bytes",
          start: Number.NaN,
          end: Number.NaN,
          size: 100,
        }),
      ).toBe("bytes */100");
      expect(
        ContentRangeHeader.render({
          unit: "bytes",
          start: Number.NaN,
          end: Number.NaN,
          size: Number.NaN,
        }),
      ).toBe("bytes */*");
      expect(
        ContentRangeHeader.render({
          unit: "bytes",
          start: Number.NaN,
          end: Number.NaN,
          size: Infinity,
        }),
      ).toBe("bytes */*");
    });

    test("errors on '*' ranges", () => {
      const header = "bytes */*";
      expect(() => ContentRangeHeader.parse(header)).toThrow(
        ReasonPhrases.REQUESTED_RANGE_NOT_SATISFIABLE,
      );
    });
  });

  describe("RangeHeader", () => {
    describe.each([
      {
        case: "closed interval",
        header: "bytes=0-10",
        range: { unit: "bytes", start: 0, end: 10, size: NaN } as Range,
      },
      {
        case: "open interval start",
        header: "bytes=-10",
        range: { unit: "bytes", start: NaN, end: 10, size: NaN } as Range,
      },
      {
        case: "open interval end",
        header: "bytes=0-",
        range: { unit: "bytes", start: 0, end: NaN, size: NaN } as Range,
      },
    ])("$case", ({ header, range }) => {
      test("should parse", () => {
        const [check, err] = RangeHeader.parse(header);
        expect(err).toBeNull();
        expect(check).toStrictEqual(range);
      });

      test("round-trip: render(parse(header)[0]) equals header", () => {
        const [parsed] = RangeHeader.parse(header);
        expect(parsed).not.toBeNull();
        expect(RangeHeader.render(parsed!)).toBe(header);
      });
    });

    test("parse returns [null, err] for bytes=-", () => {
      const [range, err] = RangeHeader.parse("bytes=-");
      expect(range).toBeNull();
      expect(err).not.toBeNull();
      expect(err!.status).toBe(StatusCodes.REQUESTED_RANGE_NOT_SATISFIABLE);
    });

    test("parse returns [null, err] for unsatisfiable bytes=10-5", () => {
      const [range, err] = RangeHeader.parse("bytes=10-5");
      expect(range).toBeNull();
      expect(err).not.toBeNull();
      expect(err!.status).toBe(StatusCodes.REQUESTED_RANGE_NOT_SATISFIABLE);
    });
  });

  describe("rangeToSpan", () => {
    test("satisfiable closed range", () => {
      const [span] = rangeToSpan(
        { unit: "bytes", start: 0, end: 9, size: Number.NaN },
        100,
      );
      expect(span).not.toBeNull();
      expect(span).toStrictEqual({ start: 0, end: 9, length: 10 });
    });

    test("satisfiable suffix range", () => {
      const [span] = rangeToSpan(
        { unit: "bytes", start: Number.NaN, end: 10, size: Number.NaN },
        100,
      );
      expect(span).not.toBeNull();
      expect(span).toStrictEqual({ start: 90, end: 99, length: 10 });
    });

    test("satisfiable open-ended range", () => {
      const [span] = rangeToSpan(
        { unit: "bytes", start: 50, end: Number.NaN, size: Number.NaN },
        100,
      );
      expect(span).not.toBeNull();
      expect(span).toStrictEqual({ start: 50, end: 99, length: 50 });
    });

    test("unsatisfiable: start >= totalSize", () => {
      const [span, contentRange] = rangeToSpan(
        { unit: "bytes", start: 100, end: 199, size: Number.NaN },
        100,
      );
      expect(span).toBeNull();
      expect(contentRange).toBe("bytes */100");
    });

    test("unsatisfiable: end < start", () => {
      const [span, contentRange] = rangeToSpan(
        { unit: "bytes", start: 10, end: 5, size: Number.NaN },
        100,
      );
      expect(span).toBeNull();
      expect(contentRange).toBe("bytes */100");
    });

    test("unsatisfiable: suffix with unknown totalSize", () => {
      const [span, contentRange] = rangeToSpan(
        { unit: "bytes", start: Number.NaN, end: 10, size: Number.NaN },
        Number.NaN,
      );
      expect(span).toBeNull();
      expect(contentRange).toBe("bytes */*");
    });

    test("empty resource: whole-file request resolves to an empty span", () => {
      // Regression: a default whole-file range ({ start: 0, end: NaN }) against
      // totalSize 0 previously resolved to end = -1 and returned a spurious 416.
      const [span, contentRange] = rangeToSpan(
        { unit: "bytes", start: 0, end: Number.NaN, size: Number.NaN },
        0,
      );
      expect(contentRange).toBeNull();
      expect(span).toStrictEqual({ start: 0, end: -1, length: 0 });
    });

    test("empty resource: suffix request resolves to an empty span", () => {
      const [span, contentRange] = rangeToSpan(
        { unit: "bytes", start: Number.NaN, end: 10, size: Number.NaN },
        0,
      );
      expect(contentRange).toBeNull();
      expect(span).toStrictEqual({ start: 0, end: -1, length: 0 });
    });

    test("empty resource: explicit bounded range is unsatisfiable (416)", () => {
      const [span, contentRange] = rangeToSpan(
        { unit: "bytes", start: 0, end: 9, size: Number.NaN },
        0,
      );
      expect(span).toBeNull();
      expect(contentRange).toBe("bytes */0");
    });
  });
});
