import { fetchConnectedAppToken } from "@/lib/kinde/connected-apps";
import { storedKeyEnv } from "@/lib/env";
import { CONNECTED_APP, STORED_KEY, type StorageMode } from "@/lib/storage-mode";

/**
 * Getting a credential, per mode. This is where the two modes actually differ,
 * and the difference is the whole demo.
 *
 * The value returned here lives for the length of one action and is then
 * dropped. It is never returned to a caller outside the broker, never written
 * to the store, and never logged.
 */

export type CredentialResult =
  | { ok: true; token: string; source: StorageMode }
  | { ok: false; reason: string; status: number };

export interface ConnectedAppSource {
  /** Kinde connected app session handle. Not a GitHub credential. */
  kindeSessionId: string | null | undefined;
  /** Connection state as the store records it. */
  status: "linked" | "revoked" | "unlinked";
}

/**
 * connected-app mode.
 *
 * The app holds nothing between actions. It asks Kinde every time.
 *
 * Kinde replays the same token for its eight-hour life rather than minting a
 * new one per call — measured. The security property is not that the token is
 * new; it is that the APP holds nothing between actions, so there is no
 * credential here for a revocation to have to chase.
 */
export async function acquireConnectedAppToken(
  source: ConnectedAppSource,
): Promise<CredentialResult> {
  // Fail closed before Kinde is even asked.
  if (source.status !== "linked") {
    return {
      ok: false,
      status: 0,
      reason: `The GitHub connection is ${source.status}. Refusing to act.`,
    };
  }
  if (!source.kindeSessionId) {
    return {
      ok: false,
      status: 0,
      reason: "No connected app session for this user. Refusing to act.",
    };
  }

  const result = await fetchConnectedAppToken(source.kindeSessionId);
  if (!result.ok) {
    // INVALID_SESSION lands here after a revocation. Measured at +0ms.
    return { ok: false, status: result.status, reason: result.reason };
  }

  return { ok: true, token: result.token.accessToken, source: CONNECTED_APP };
}

/**
 * stored-key mode — the hole, reproduced faithfully.
 *
 * The app holds its own long-lived GitHub token and uses it directly. Note
 * what this function does NOT do: it never contacts Kinde, and it never looks
 * at the connection's status. That is not an oversight, it is the bug being
 * demonstrated.
 *
 * Because nothing in this path consults Kinde, revoking the connection there
 * has no effect on it whatsoever. A stored-key agent carries on acting — for
 * as long as the held token lives, which for a classic personal access token
 * is until someone revokes it at GitHub by hand.
 */
export function acquireStoredKeyToken(): CredentialResult {
  try {
    return {
      ok: true,
      token: storedKeyEnv().GITHUB_STORED_TOKEN,
      source: STORED_KEY,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      reason:
        "STORAGE_MODE is stored-key but GITHUB_STORED_TOKEN is not set. Refusing to act.",
    };
  }
}
