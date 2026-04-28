import HttpError from "http-errors";
import { StatusCodes } from "http-status-codes";

/**
 * @function groups
 * @description Fetches the groups for a given connector.
 * @param {GoogleAuth<AuthClient>} client the Google Auth client from credentials.
 * @param {string | undefined} pageToken page token on group listing.
 * @returns {Schema$ListGroupsResponse} list of IAM user groups.
 */
async function groups<C, G>($: C, pageToken?: string): Promise<[G[], string?]> {
  throw HttpError(StatusCodes.NOT_IMPLEMENTED, "Not implemented");
}

/**
 * @function groupMemebers
 * @description Fetches the members of a group.
 * @param {GoogleAuth<AuthClient>} client the Google Auth client from credentials.
 * @param {string | undefined} groupId the group id to fetch users from.
 * @returns {Schema$ListMembershipsResponse} a list of members associated with a group.
 */
async function groupMemebers<C, M>($: C, groupId: string): Promise<M[]> {
  throw HttpError(StatusCodes.NOT_IMPLEMENTED, "Not implemented");
}

export { groups, groupMemebers };
