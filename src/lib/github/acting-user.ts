/**
 * Who acted, read from the response rather than from a scope.
 *
 * The GitHub connection grants `public_repo` and nothing else. There is no
 * identity scope, so the acting login cannot be looked up as a separate
 * privilege. It does not need to be: GitHub echoes the authenticated account
 * back in the responses the actions already make.
 *
 *   POST /repos/{o}/{r}/issues/{n}/comments  ->  { user: { login } }
 *   POST /repos/{o}/{r}/pulls                ->  { user: { login } }
 *   GET  /user                               ->  { login }
 *
 * `GET /user` is included because it needs no scope at all — it returns the
 * public profile of whoever the token belongs to. Read actions that return no
 * identity simply yield null, and the audit row records the action without a
 * login rather than the app widening the connection to get one.
 */

export interface ActingUser {
  login: string;
  /** GitHub's numeric account id, when the response carries it. */
  id: number | null;
}

interface MaybeUser {
  login?: unknown;
  id?: unknown;
  user?: { login?: unknown; id?: unknown } | null;
}

/**
 * Pull the acting GitHub account out of an API response body.
 *
 * Returns null when the response carries no identity. That is a normal
 * outcome, not an error.
 */
export function actingUserFrom(payload: unknown): ActingUser | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as MaybeUser;

  // A nested `user` is the shape returned by comments and pull requests.
  const candidate =
    typeof body.user?.login === "string"
      ? body.user
      : typeof body.login === "string"
        ? body
        : null;

  if (!candidate || typeof candidate.login !== "string") return null;

  return {
    login: candidate.login,
    id: typeof candidate.id === "number" ? candidate.id : null,
  };
}
