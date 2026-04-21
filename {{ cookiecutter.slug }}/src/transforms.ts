/**
 * @file transforms.ts
 * @description
 *
 *   From a style perspective, the Connectors Squad prefers `map` / `filter` /
 *   `reduce` semantics over `forEach` and `for` loops. This is because
 *   Connectors should be mutation free, (i.e. we don't write anywhere).
 *
 *   A `Transform` is a stateless function that takes the `props` from the
 *   System of Record (ideally strongly-typed), and transforms it into our
 *   Connector schema.
 *
 *   Using a `Transform` often looks like:
 *
 *   @example
 *
 *     ```js
 *     const items: Item[] = await client.get("/items").json()
 *     const transformed = items.map(Transform);
 *     ```
 *
 * @see UCP connector schema (`ext/connector/v1alpha1/connector`)
 */
import * as uuid from "uuid";

import type { Locals } from "express";

/**
 * @function ResponseMetadata
 * @param locals cached during middleware on response.
 * @returns {ResourceMetadata}
 */
interface RequestLocals extends Locals {
  startTimeMs: number;
}

function ResponseMetadata(locals: RequestLocals) {
    return {
      uuid: uuid.v4(),
      responseTimeMillis: Date.now() - locals.startTimeMs,
    }
}

/**
 * @function ContentItem
 * @param props.item from the System of Record for a specific piece of Content
 * @param props.query params from the request
 * @param props.locals cached during middleware on response.
 * @returns {ContentItem} Universal Connector Protocol (UCP) content.
 */
function ContentItem(props: { item, query, locals }) {
  return {
    connectorId: props.locals.connectorId,
    seedSourceLocation: props.query.seedSourceLocation,
    parentId: undefined,
    contentId: undefined,
    sourceLocation: undefined,
    displaySourceLocation: undefined,
    path: undefined,
    version: undefined,
    title: undefined,
    description: "",
    mimeType: undefined,
    fileExtension: undefined,
    createdAt: undefined,
    createdBy: undefined,
    updatedAt: undefined,
    updatedBy: undefined,
    size: undefined,
  }
}

export default {
  ContentItem,
  ResponseMetadata,
}
