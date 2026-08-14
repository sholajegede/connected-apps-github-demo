import { createHash } from "node:crypto";

/**
 * Describe a token without revealing it.
 *
 * The demo needs to answer questions like "how long does this live?" and "is
 * the second fetch the same token as the first?". Both are answerable from a
 * shape and a fingerprint, so the secret itself never has to be printed,
 * stored or logged.
 */

export interface TokenShape {
  /** Character length. */
  length: number;
  /** GitHub's public token type prefix, such as `gho_`. Not secret. */
  kind: string;
  /** True when the value is a JSON Web Token rather than an opaque string. */
  isJwt: boolean;
  /**
   * A truncated SHA-256 of the token. Two fetches can be compared for
   * equality without either value being exposed.
   */
  fingerprint: string;
}

const GITHUB_PREFIXES = [
  "ghp_", // personal access token, classic
  "gho_", // OAuth app token
  "ghu_", // GitHub App user-to-server token
  "ghs_", // GitHub App server-to-server token
  "ghr_", // refresh token
  "github_pat_", // fine-grained personal access token
] as const;

export function describeToken(token: string): TokenShape {
  const kind =
    GITHUB_PREFIXES.find((prefix) => token.startsWith(prefix)) ?? "opaque";

  return {
    length: token.length,
    kind,
    isJwt: /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token),
    fingerprint: createHash("sha256").update(token).digest("hex").slice(0, 12),
  };
}
