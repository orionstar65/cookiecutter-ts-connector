import HttpError from "http-errors";
import { StatusCodes, ReasonPhrases } from "http-status-codes";

import * as pb from "@bufbuild/protobuf";
import { JsonValue } from "@bufbuild/protobuf";

export interface Range {
  unit: "bytes";
  start: number;
  end: number;
  size: number;
}

export type ParseRangeResult =
  | [Range, null]
  | [null, ReturnType<typeof HttpError>];

export function RangeNotSatisfiableError(
  message: string = ReasonPhrases.REQUESTED_RANGE_NOT_SATISFIABLE,
): ReturnType<typeof HttpError> {
  return HttpError(StatusCodes.REQUESTED_RANGE_NOT_SATISFIABLE, message);
}

/**
 * @object ContentRangeHeader
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Range
 */
export const ContentRangeHeader = {
  pattern:
    /(?<units>bytes) (?<range>((?<start>\d+)-(?<end>\d+))|\\*)\/(?<size>\d+|\*)/,

  parse(value: string): Range {
    // Match the pattern from MDN
    const match = this.pattern.exec(value);

    if (!match)
      throw HttpError(
        StatusCodes.REQUESTED_RANGE_NOT_SATISFIABLE,
        ReasonPhrases.REQUESTED_RANGE_NOT_SATISFIABLE,
      );

    // Test the rance against MDN spec.
    if (match.groups!.range === "*" || match.groups!.size === "0")
      throw HttpError(
        StatusCodes.REQUESTED_RANGE_NOT_SATISFIABLE,
        ReasonPhrases.REQUESTED_RANGE_NOT_SATISFIABLE,
      );

    // PARSE
    const unit = "bytes";
    const start = Number(match.groups!.start);
    const end = Number(match.groups!.end);
    const size = Number(match.groups!.size) || Infinity;

    return { unit, start, end, size };
  },

  render({ unit, start, end, size }: Range): string {
    if (Number.isNaN(start) || Number.isNaN(end))
      return `${unit} */${Number.isFinite(size) ? size : "*"}`;
    return `${unit} ${start}-${end}/${Number.isFinite(size) ? size : "*"}`;
  },
};

/**
 * @object RangeHeader
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Range
 */
export const RangeHeader = {
  pattern: /(?<units>bytes)=(?<range>(?<start>\d+)?-(?<end>\d+)?)/,

  parse(value: string): ParseRangeResult {
    const match = this.pattern.exec(value);

    if (!match || match.groups?.range === "-")
      return [null, RangeNotSatisfiableError()];

    const start = Number(match.groups?.start);
    const end = Number(match.groups?.end);

    if (!Number.isNaN(start) && !Number.isNaN(end) && start > end)
      return [null, RangeNotSatisfiableError()];

    return [{ unit: "bytes", start, end, size: Number.NaN }, null];
  },

  render({ unit, start, end }: Range): string {
    const allNaNs = [start, end].every(Number.isNaN);
    if (allNaNs)
      throw HttpError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        ReasonPhrases.REQUESTED_RANGE_NOT_SATISFIABLE,
      );
    return `${unit}=${Number.isNaN(start) ? "" : start}-${Number.isNaN(end) ? "" : end}`;
  },
};

/**
 * Resolves a parsed Range and totalSize to a concrete span, or returns the
 * Content-Range string for a 416 response when the range is unsatisfiable.
 */
export function rangeToSpan(
  range: Range,
  totalSize: number,
): [{ start: number; end: number; length: number }, null] | [null, string] {
  // An empty resource (totalSize 0) has no addressable bytes. A whole-file or
  // suffix request is satisfiable with an empty span (length 0); only an
  // explicit bounded range (both start and end given) is unsatisfiable. Without
  // this, the default whole-file range ({ start: 0, end: NaN }) resolves to
  // end = totalSize - 1 = -1 and trips the `end < start` / `start >= totalSize`
  // guards below, producing a spurious 416 for downloads of empty files.
  if (Number.isFinite(totalSize) && totalSize === 0) {
    const explicitBounded =
      !Number.isNaN(range.start) && !Number.isNaN(range.end);
    if (explicitBounded)
      return [
        null,
        ContentRangeHeader.render({
          unit: "bytes",
          start: Number.NaN,
          end: Number.NaN,
          size: 0,
        }),
      ];
    return [{ start: 0, end: -1, length: 0 }, null];
  }

  let start: number;
  let end: number;
  if (Number.isNaN(range.start) && !Number.isNaN(range.end)) {
    if (!Number.isFinite(totalSize))
      return [
        null,
        ContentRangeHeader.render({
          unit: "bytes",
          start: Number.NaN,
          end: Number.NaN,
          size: totalSize,
        }),
      ];
    end = totalSize - 1;
    start = Math.max(0, totalSize - range.end);
  } else if (!Number.isNaN(range.start) && Number.isNaN(range.end)) {
    if (!Number.isFinite(totalSize))
      return [
        null,
        ContentRangeHeader.render({
          unit: "bytes",
          start: Number.NaN,
          end: Number.NaN,
          size: totalSize,
        }),
      ];
    start = range.start;
    end = totalSize - 1;
  } else {
    start = range.start;
    end = Number.isFinite(totalSize)
      ? Math.min(range.end, totalSize - 1)
      : range.end;
  }
  if (
    start < 0 ||
    (Number.isFinite(totalSize) && start >= totalSize) ||
    end < start ||
    Number.isNaN(start) ||
    Number.isNaN(end)
  ) {
    return [
      null,
      ContentRangeHeader.render({
        unit: "bytes",
        start: Number.NaN,
        end: Number.NaN,
        size: totalSize,
      }),
    ];
  }
  return [{ start, end, length: end - start + 1 }, null];
}

export function safeFromJson<T extends pb.DescMessage>(
  schema: T,
  json: JsonValue,
): pb.MessageShape<T> {
  const knownFields = schema.fields.map((f) => f.localName);
  const inputFields = Object.keys(json as object);

  const unknownFields = inputFields.filter((f) => !knownFields.includes(f));
  if (unknownFields.length) {
    const fields = unknownFields.slice(0, 5);
    throw new Error(`Unknown fields in JSON: \n\t- ${fields.join("\n\t- ")}`);
  }

  return pb.fromJson(schema, json);
}
