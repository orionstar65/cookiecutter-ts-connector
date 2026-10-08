import fs from "node:fs";
import os from "node:os";

import jws from "jws";

export const DefaultKeyPath = "/ucp/secrets/crypto.json";
export const DefaultAlgorithm = "HS256";

export default class AutoRefreshToken {
  sub: string;
  ttl: number;
  iat: number;
  exp: number;
  alg: string;

  private token: string;
  private claims: object;
  private keyPath: string;
  private key: string;

  /**
   * Parse the `token` to construct a new AutoRefreshToken with the same `payload`.
   *
   * @param {string} token The signed jwt
   * @returns {AutoRefreshToken}
   */
  static parse(token: string): AutoRefreshToken {
    // Verify the jws token.
    const key = readSigningKey(DefaultKeyPath);
    const valid = jws.verify(token, DefaultAlgorithm, key);
    if (!valid) throw new Error("InvalidToken");

    // Decode and de-struct the token.
    const { header, payload } = jws.decode(token);

    // Parse the claims
    const claims = {
      org: payload.org,
      roles: payload.roles,
      operator_roles: payload.operator_roles,
      iss: payload.iss,
      aud: payload.aud,
    };

    // Parse the core args
    const [sub, ttl, alg] = [
      payload.sub,
      payload.exp - payload.iat,
      header.algorithm,
    ];

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return new AutoRefreshToken(sub, ttl, claims, alg);
  }

  constructor(
    sub: string,
    ttl: number,
    claims: object = {},
    alg: string = DefaultAlgorithm,
    keyPath: string = DefaultKeyPath,
  ) {
    if (jws.ALGORITHMS.includes(alg)) throw new Error("");

    // Context / Claim props
    this.sub = sub;
    this.ttl = ttl;
    this.iat = Math.floor(Date.now() / 1000);
    this.exp = this.iat + ttl;
    this.alg = alg;
    this.claims = claims;

    // Token and Signature
    this.keyPath = keyPath;
    this.key = readSigningKey(this.keyPath);
    this.token = this.getToken();
  }

  header(): object {
    return { algorithm: this.alg };
  }

  payload(): object {
    return { sub: this.sub, iat: this.iat, exp: this.exp, ...this.claims };
  }

  refresh() {
    this.iat = Math.floor(Date.now() / 1000);
    this.exp = this.iat + this.ttl;
    this.token = jws.sign({
      header: this.header(),
      payload: this.payload(),
      secret: this.key,
    });
  }

  isExpired(): boolean {
    const currentTime = Math.floor(Date.now() / 1000);
    return currentTime >= this.exp;
  }

  getToken(): string {
    // Refresh the token if it's empty or expired.
    if (!this.token || this.isExpired()) this.refresh();
    return this.token;
  }

  toString(): string {
    return this.getToken();
  }
}

/**
 * Get an AutoRefreshToken impersonating OrgAdmin with the default signatures.
 *
 * @param {string} org OrgId for the claims.
 * @param {number} ttl Time-to-live (ttl) before refreshing.
 * @returns
 */
export function ImpersonateOrgAdmin(
  org: string,
  ttl: number,
): AutoRefreshToken {
  const sub = os.hostname() + "@localhost";
  const claims = {
    org: org,
    roles: ["ORG_ADMIN"],
    operator_roles: ["ORG_IMPERSONATOR"],
    iss: "local/internal",
    aud: "ucp-api",
  };

  return new AutoRefreshToken(sub, ttl, claims);
}

/**
 * Reads and decodes a signing key given a `keyPath`.
 *
 * @param {string} keyPath path to JWS signing key.
 * @returns
 */
export function readSigningKey(keyPath: string): string {
  let signingKey: string;

  // Path 1: JSON file containing an hmac JSON object.
  if (keyPath.endsWith(".json")) {
    const hmacJSON = fs.readFileSync(DefaultKeyPath, "utf8");
    const hmacObj = JSON.parse(hmacJSON);
    signingKey = hmacObj.hmac_key;
  }
  // Path 2: Containined the raw key as a string.
  else if (keyPath.endsWith(".txt")) {
    signingKey = fs.readFileSync(keyPath, "utf8");
  }
  // Else, unsupported extension
  else {
    throw new Error("SignatureReadError: Unsupported file extension");
  }

  return signingKey.replace(/\\n/g, "\n");
}

/**
 * Verifies jwt token and returns token payload.
 *
 * @param {string} token - signed jwt
 * @param {string} hmacKey - secret key used to sign the token
 * @return {*} claims payload (empty payload if token cannot be verified)
 */
export function verify(
  token: string,
  algorithm: string = DefaultAlgorithm,
  keyPath: string = DefaultKeyPath,
): { org: string } | undefined {
  const signingKey = readSigningKey(keyPath);
  const valid = jws.verify(token, algorithm, signingKey);
  const { payload } = jws.decode(token) as { payload: { org: string } };
  return valid ? payload : undefined;
}

/**
 * Verifies the jwt using the default `hmacKey` and returns the OrgId on
 * the token claims.
 *
 * @param {string} token - signed jwt
 * @returns {string} The org on the claims
 */
export function getOrgIdFromJwt(
  token: string,
  algorithm: string = DefaultAlgorithm,
  keyPath: string = DefaultKeyPath,
) {
  // Only extract and return the namespace from decoded payload
  const claims = verify(token, algorithm, keyPath);
  return claims!.org;
}

export function parseBearerToken(
  token: string | undefined,
): string | undefined {
  if (!token) return undefined;
  const parts = token.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    return undefined;
  }
  return parts[1];
}
