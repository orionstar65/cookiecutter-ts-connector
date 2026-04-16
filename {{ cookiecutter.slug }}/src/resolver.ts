/**
 * @file resolver.ts
 * @description
 *
 *   A `Resolver` is a pure-functional interface responsible for translating
 *   a `uri` string into a URL.
 *
 *   Often, we extend the base "node:url" URL type by implementing the
 *   `file-system` interface, and resolve to those, in which case
 *   this file starts to look like a `FileSystem`.
 *
 *   When that starts to get too complex, consider a fully-fledged `FileSystem`
 *   implementation.
 *
 * @see local file-system / connector resolver patterns in this template
 */
import type { URL } from "url";

import HttpError from "http-errors";
import { StatusCodes } from "http-status-codes";

type Resolver<U extends URL, C> = (uri: string, $: C) => Promise<U>;

const resolve = async<C, U extends URL>(uri: string, $: C): Promise<U> => {
  throw HttpError(StatusCodes.NOT_IMPLEMENTED, "Not implemented");
}

export default { resolve };
