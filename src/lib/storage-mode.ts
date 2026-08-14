/**
 * The two operating modes of the demo.
 *
 * - `stored-key`   the app holds its own long-lived GitHub token
 * - `connected-app` the app holds nothing and brokers a fresh per-user token
 *
 * The mode is a deployment decision. It is resolved on the server from the
 * process environment only. It is never read from a request, a header, a
 * cookie, a query string or anything the agent or the browser can influence.
 *
 * This module is pure so that the resolution rule can be tested directly.
 */

export const STORED_KEY = "stored-key" as const;
export const CONNECTED_APP = "connected-app" as const;

export type StorageMode = typeof STORED_KEY | typeof CONNECTED_APP;

/**
 * Resolve the storage mode from a raw environment value.
 *
 * Only the exact string `stored-key` selects the unsafe mode. Every other
 * value — unset, empty, misspelled, mixed case, injected — resolves to
 * `connected-app`, which is the safe mode. The demo fails closed.
 */
export function resolveStorageMode(raw: string | undefined | null): StorageMode {
  return raw === STORED_KEY ? STORED_KEY : CONNECTED_APP;
}

export function isConnectedAppMode(mode: StorageMode): boolean {
  return mode === CONNECTED_APP;
}
