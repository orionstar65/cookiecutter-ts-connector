/* eslint-disable no-unnecessary-escape */
import { NextFunction, Request, Response, Router } from "express";
import HttpError from "http-errors";
import { StatusCodes } from "http-status-codes";

import * as pb from "@bufbuild/protobuf";
import validate from "@ucp/express/validate.js";
import * as schemas from "@ucp/api-schema-connect/ext/connector/v1alpha1/connector_pb.js";

import client from "@{{ cookiecutter.username }}/{{ cookiecutter.slug }}/client.js";
import resolver from "@{{ cookiecutter.username }}/{{ cookiecutter.slug }}/resolver.js";
import transforms from "@{{ cookiecutter.username }}/{{ cookiecutter.slug }}/transforms.js";

const router: Router = Router();

router.get(
  "/contents\:pull",
  validate({ query: schemas.PullContentsRequestSchema }),
  listContents,
);
async function listContents(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  try {
    const { locals } = response;
    const query = pb.fromJson(schemas.PullContentsRequestSchema, request.query);
    const filesystem = await client.connect(locals.credential);
    const entry = resolver.resolve(query.seedSourceLocation, filesystem);

    // Do something like...
    //
    // const children = await entry.children()
    // const items = children.map((item) => {
    //   const props = { item, query, locals }
    //   const metadata = transforms.TransformMetadata(props)
    //   const data = transforms.TransformContentItem(props)
    //   return pb.create(schemas.Content, { metadata, data })
    // });
    //
    // response.status(StatusCodes.OK).json({ metadata, items })
    //
    response.status(StatusCodes.NOT_IMPLEMENTED).send()
  } catch (e) {
    next(e);
  }
}

router.get(
  "/content/metadata",
  validate({ query: schemas.GetMetadataRequestSchema }),
  getMetadata,
);
async function getMetadata(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  try {
    const query = pb.fromJson(schemas.GetMetadataRequestSchema, request.query);
    const filesystem = await client.connect(response.locals.credential);
    const entry = resolver.resolve(query.seedSourceLocation, filesystem);

    // Do something...
    response.status(StatusCodes.NOT_IMPLEMENTED).send()
  } catch (e) {
    next(e);
  }
}

router.get(
  "/content-data\:download",
  validate({ query: schemas.DownloadContentDataRequestSchema }),
  readContent,
);
async function readContent(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  try {
    const query = pb.fromJson(
      schemas.DownloadContentDataRequestSchema,
      request.query,
    );
    const filesystem = await client.connect(response.locals.credential);
    const entry = resolver.resolve(query.seedSourceLocation, filesystem);

    // Do something like...
    //
    //
    //
    response.status(StatusCodes.NOT_IMPLEMENTED).send()
  } catch (e) {
    next(e);
  }
}

router.get(
  "/content/read-permission",
  validate({ query: schemas.GetReadPermissionRequestSchema }),
  getContentPermissions,
);
async function getContentPermissions(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  try {
    const query = pb.fromJson(
      schemas.GetReadPermissionRequestSchema,
      request.query,
    );

    const filesystem = await client.connect(response.locals.credential);
    const entry = resolver.resolve(query.sourceLocation, filesystem);

    // Do something like...
    //
    //
    //

    response.status(StatusCodes.NOT_IMPLEMENTED).send()
  } catch (e) {
    next(e);
  }
}

router.get(
  "/group-permissions",
  validate({ query: schemas.ListGroupPermissionsRequestSchema }),
  getPermissionGroups,
);
async function getPermissionGroups(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  try {
    const query = pb.fromJson(
      schemas.ListGroupPermissionsRequestSchema,
      request.query,
    );

    // Do something...
    response.status(StatusCodes.NOT_IMPLEMENTED).send()
  } catch (e) {
    next(e);
  }
}

router.get(
  "/group-permission/members",
  validate({ query: schemas.ListGroupPermissionMembersRequestSchema }),
  getPermissionGroupMembers,
);
async function getPermissionGroupMembers(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  try {
    const query = pb.fromJson(
      schemas.ListGroupPermissionMembersRequestSchema,
      request.query,
    );

    // Do something...
    response.status(StatusCodes.NOT_IMPLEMENTED).send()
  } catch (e) {
    next(e);
  }
}

export default router;
