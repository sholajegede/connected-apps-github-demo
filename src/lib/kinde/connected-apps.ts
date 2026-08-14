import { kindeManagementEnv } from "@/lib/env";
import { managementRequest, type ManagementResponse } from "./management";

/**
 * Kinde Connected Apps.
 *
 * Kinde holds the GitHub authorization: the refresh token stays on Kinde's
 * side and never reaches this app. This app asks for a short-lived access
 * token when it needs one, uses it once and drops it.
 *
 * Nothing in this module writes a token to a database, a file or a log.
 */

const AUTH_URL_PATH = "/api/v1/connected_apps/auth_url";
const TOKEN_PATH = "/api/v1/connected_apps/token";
const REVOKE_PATH = "/api/v1/connected_apps/revoke";
const USER_SESSIONS_PATH = (userId: string) =>
  `/api/v1/users/${encodeURIComponent(userId)}/sessions`;

export interface ConnectedAppAuthUrl {
  /** Where to send the user to authorize GitHub. */
  url: string;
  /** Identifies the connected app session for later token fetches. */
  sessionId: string;
}

export interface BrokeredToken {
  /** Short-lived GitHub access token. Never persisted, never logged. */
  accessToken: string;
  /** Expiry as Kinde reported it. */
  expiresAtRaw: string;
  expiresAt: Date | null;
}

/**
 * Start the GitHub authorization for one user.
 *
 * `key_code_ref` names the connected app configured in Kinde. It is
 * configuration, supplied from the environment, never a literal.
 */
export async function getConnectedAppAuthUrl(options: {
  kindeUserId: string;
  overrideCallbackUrl?: string;
  token?: string;
}): Promise<ConnectedAppAuthUrl> {
  const env = kindeManagementEnv();

  const response = await managementRequest<{
    url?: string;
    session_id?: string;
  }>({
    path: AUTH_URL_PATH,
    query: {
      key_code_ref: env.KINDE_GITHUB_CONNECTED_APP_KEY,
      user_id: options.kindeUserId,
      override_callback_url: options.overrideCallbackUrl,
    },
    token: options.token,
  });

  if (!response.ok || !response.body?.url || !response.body?.session_id) {
    throw new Error(
      `Kinde did not return a connected app auth url (HTTP ${response.status}).`,
    );
  }

  return { url: response.body.url, sessionId: response.body.session_id };
}

/**
 * The result of asking Kinde for a GitHub token.
 *
 * A refusal is a first-class outcome, not an exception: the demo needs to
 * observe and audit the moment Kinde stops handing tokens out.
 */
export type TokenFetchResult =
  | { ok: true; token: BrokeredToken; status: number; durationMs: number }
  | { ok: false; status: number; reason: string; durationMs: number };

/**
 * Fetch a fresh GitHub access token for a connected app session.
 *
 * The caller uses the token for one action and lets it fall out of scope. It
 * is never returned to the browser and never stored.
 */
export async function fetchConnectedAppToken(
  sessionId: string,
  token?: string,
): Promise<TokenFetchResult> {
  const response = await managementRequest<{
    access_token?: string;
    access_token_expiry?: string;
    errors?: { code?: string; message?: string }[];
  }>({ path: TOKEN_PATH, query: { session_id: sessionId }, token });

  if (!response.ok || !response.body?.access_token) {
    return {
      ok: false,
      status: response.status,
      reason: describeRefusal(response),
      durationMs: response.durationMs,
    };
  }

  const expiresAtRaw = response.body.access_token_expiry ?? "";
  const parsed = expiresAtRaw ? new Date(expiresAtRaw) : null;

  return {
    ok: true,
    status: response.status,
    durationMs: response.durationMs,
    token: {
      accessToken: response.body.access_token,
      expiresAtRaw,
      expiresAt: parsed && !Number.isNaN(parsed.valueOf()) ? parsed : null,
    },
  };
}

/**
 * Revoke the tokens held against one connected app session. This is the
 * targeted kill switch: it cuts the GitHub link and leaves the user's session
 * with the app alone.
 */
export async function revokeConnectedAppSession(
  sessionId: string,
  token?: string,
): Promise<ManagementResponse<unknown>> {
  return await managementRequest({
    path: REVOKE_PATH,
    method: "POST",
    query: { session_id: sessionId },
    token,
  });
}

/**
 * Invalidate every Kinde session the user holds. Broader than the connected
 * app revocation — it reaches the user's own session with the app too.
 */
export async function deleteUserSessions(
  kindeUserId: string,
  token?: string,
): Promise<ManagementResponse<unknown>> {
  return await managementRequest({
    path: USER_SESSIONS_PATH(kindeUserId),
    method: "DELETE",
    token,
  });
}

export async function getUserSessions(
  kindeUserId: string,
  token?: string,
): Promise<ManagementResponse<unknown>> {
  return await managementRequest({
    path: USER_SESSIONS_PATH(kindeUserId),
    token,
  });
}

function describeRefusal(response: {
  status: number;
  body: { errors?: { code?: string; message?: string }[] } | null;
}): string {
  const first = response.body?.errors?.[0];
  if (first?.message) return `${first.code ?? "error"}: ${first.message}`;
  return `Kinde returned HTTP ${response.status} with no token.`;
}
