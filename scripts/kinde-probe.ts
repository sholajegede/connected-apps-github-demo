/**
 * A live probe of Kinde Connected Apps.
 *
 * This script measures behaviour rather than assuming it. It answers three
 * questions the demo depends on:
 *
 *   1. How long does a brokered GitHub token live?
 *   2. Does Kinde hold the refresh token, or does this app ever see one?
 *   3. When a connection is revoked, does the NEXT token fetch fail, and how
 *      fast?
 *
 * It never prints an access token. Tokens are described by shape and by a
 * truncated fingerprint, which is enough to compare two fetches.
 *
 * Usage:
 *   npm run probe -- link <kindeUserId>
 *   npm run probe -- token
 *   npm run probe -- github
 *   npm run probe -- sessions <kindeUserId>
 *   npm run probe -- revoke-session
 *   npm run probe -- revoke-user-sessions <kindeUserId>
 */

import { config as loadEnv } from "dotenv";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  deleteUserSessions,
  fetchConnectedAppToken,
  getConnectedAppAuthUrl,
  getUserSessions,
  revokeConnectedAppSession,
} from "../src/lib/kinde/connected-apps";
import { getManagementToken } from "../src/lib/kinde/management";
import { describeToken } from "../src/lib/kinde/token-shape";
import { actingUserFrom } from "../src/lib/github/acting-user";

loadEnv({ path: [".env.local", ".env"], quiet: true });

/** Local scratch for the connected app session id. Gitignored. */
const SESSION_FILE = resolve(process.cwd(), ".kinde-session.json");

interface SavedSession {
  sessionId: string;
  kindeUserId: string;
  createdAt: string;
}

function saveSession(session: SavedSession): void {
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
}

function loadSession(): SavedSession {
  if (!existsSync(SESSION_FILE)) {
    throw new Error(
      "No connected app session on disk. Run `npm run probe -- link <kindeUserId>` first.",
    );
  }
  return JSON.parse(readFileSync(SESSION_FILE, "utf8")) as SavedSession;
}

function heading(text: string): void {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

/* ------------------------------------------------------------------ link -- */

async function link(kindeUserId: string): Promise<void> {
  heading("Connected app auth url");
  const { url, sessionId } = await getConnectedAppAuthUrl({ kindeUserId });
  saveSession({ sessionId, kindeUserId, createdAt: new Date().toISOString() });

  console.log(`session_id : ${sessionId}`);
  console.log(`saved to   : ${SESSION_FILE}`);
  console.log(`\nOpen this URL and authorize GitHub:\n\n${url}\n`);
  console.log("Then run: npm run probe -- token");
}

/* ----------------------------------------------------------------- token -- */

async function token(): Promise<void> {
  const session = loadSession();
  heading("Brokered GitHub token");

  const result = await fetchConnectedAppToken(session.sessionId);
  if (!result.ok) {
    console.log(`REFUSED  HTTP ${result.status} in ${result.durationMs}ms`);
    console.log(`reason   ${result.reason}`);
    process.exitCode = 1;
    return;
  }

  const shape = describeToken(result.token.accessToken);
  const expiresAt = result.token.expiresAt;
  const lifetimeSeconds = expiresAt
    ? Math.round((expiresAt.getTime() - Date.now()) / 1000)
    : null;

  console.log(`HTTP           ${result.status} in ${result.durationMs}ms`);
  console.log(`token kind     ${shape.kind}`);
  console.log(`token length   ${shape.length}`);
  console.log(`is a JWT       ${shape.isJwt}`);
  console.log(`fingerprint    ${shape.fingerprint}`);
  console.log(`expiry (raw)   ${result.token.expiresAtRaw || "(none reported)"}`);
  console.log(
    `lifetime left  ${lifetimeSeconds === null ? "(unparseable)" : `${lifetimeSeconds}s (~${Math.round(lifetimeSeconds / 60)}m)`}`,
  );

  // Does the response carry a refresh token anywhere? It must not.
  console.log(
    `refresh token  ${/refresh/i.test(JSON.stringify(result)) ? "PRESENT — investigate" : "absent from the response"}`,
  );

  // Fetch again to see whether Kinde reissues or replays the same token.
  const second = await fetchConnectedAppToken(session.sessionId);
  if (second.ok) {
    const secondShape = describeToken(second.token.accessToken);
    console.log(
      `second fetch   fingerprint ${secondShape.fingerprint} — ${secondShape.fingerprint === shape.fingerprint ? "SAME token replayed" : "DIFFERENT token issued"}`,
    );
    console.log(`second expiry  ${second.token.expiresAtRaw || "(none)"}`);
  } else {
    console.log(`second fetch   REFUSED HTTP ${second.status}`);
  }
}

/* ---------------------------------------------------------------- github -- */

async function github(): Promise<void> {
  const session = loadSession();
  heading("What the brokered token can do on GitHub");

  const result = await fetchConnectedAppToken(session.sessionId);
  if (!result.ok) {
    console.log(`REFUSED  HTTP ${result.status}: ${result.reason}`);
    process.exitCode = 1;
    return;
  }

  const response = await fetch("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${result.token.accessToken}`,
      accept: "application/vnd.github+json",
      "user-agent": "connected-apps-github-demo-probe",
    },
  });

  // `GET /user` needs no scope. The acting login is read out of the response
  // body, so the connection never has to hold an identity scope.
  const actor = actingUserFrom(await response.json());
  console.log(`GET /user      HTTP ${response.status}`);
  console.log(
    `acting as      ${actor ? `${actor.login} (id ${actor.id ?? "?"})` : "(no identity in the response)"}`,
  );
  console.log(
    `granted scopes ${response.headers.get("x-oauth-scopes") ?? "(none reported)"}`,
  );
  console.log(
    `accepted scopes ${response.headers.get("x-accepted-oauth-scopes") ?? "(none reported)"}`,
  );
  console.log(
    "\nThe granted scopes line above is the connection's real privilege.\nIt should read `public_repo` and nothing more.",
  );
  // The token goes out of scope here. Nothing wrote it anywhere.
}

/* -------------------------------------------------------------- sessions -- */

async function sessions(kindeUserId: string): Promise<void> {
  heading("Kinde sessions for this user");
  const result = await getUserSessions(kindeUserId);
  console.log(`HTTP ${result.status} in ${result.durationMs}ms`);
  console.log(JSON.stringify(result.body, null, 2));
}

/* -------------------------------------------------------- revocation test -- */

interface Probe {
  atMs: number;
  ok: boolean;
  status: number;
  detail: string;
}

/**
 * Poll the token endpoint after a revocation and report the first refusal.
 * The window is deliberately generous, so "immediate" is a measurement and
 * not a hope.
 */
async function pollAfterRevoke(
  sessionId: string,
  windowMs: number,
  intervalMs: number,
): Promise<Probe[]> {
  const startedAt = Date.now();
  const probes: Probe[] = [];

  for (;;) {
    const at = Date.now() - startedAt;
    const result = await fetchConnectedAppToken(sessionId);
    probes.push({
      atMs: at,
      ok: result.ok,
      status: result.status,
      detail: result.ok
        ? `token issued (fingerprint ${describeToken(result.token.accessToken).fingerprint})`
        : result.reason,
    });

    const label = result.ok ? "STILL ISSUING" : "REFUSED      ";
    console.log(
      `  +${String(at).padStart(6)}ms  ${label}  HTTP ${result.status}  ${probes.at(-1)!.detail}`,
    );

    if (!result.ok) break;
    if (Date.now() - startedAt >= windowMs) break;
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return probes;
}

function summarise(probes: Probe[], windowMs: number): void {
  const firstRefusal = probes.find((p) => !p.ok);
  heading("Result");
  if (firstRefusal) {
    console.log(
      `The next token fetch after revocation failed at +${firstRefusal.atMs}ms with HTTP ${firstRefusal.status}.`,
    );
    console.log(`Reason: ${firstRefusal.detail}`);
    console.log(
      firstRefusal.atMs < 1500
        ? "Revocation takes effect on the very next fetch. The kill switch can rely on it."
        : `Revocation was NOT immediate. It took ${firstRefusal.atMs}ms. The kill switch must account for this window.`,
    );
  } else {
    console.log(
      `Kinde was still issuing tokens ${windowMs}ms after revocation, across ${probes.length} attempts.`,
    );
    console.log(
      "The kill switch CANNOT rely on this lever alone. The app must also refuse locally.",
    );
  }
}

async function revokeSession(): Promise<void> {
  const session = loadSession();
  heading("Baseline: token before revocation");

  const before = await fetchConnectedAppToken(session.sessionId);
  console.log(
    before.ok
      ? `  issuing tokens (fingerprint ${describeToken(before.token.accessToken).fingerprint}, HTTP ${before.status})`
      : `  already refusing: HTTP ${before.status} ${before.reason}`,
  );
  if (!before.ok) {
    console.log("\nNothing to revoke. Relink first.");
    process.exitCode = 1;
    return;
  }

  heading("POST /api/v1/connected_apps/revoke");
  const revoke = await revokeConnectedAppSession(session.sessionId);
  console.log(`HTTP ${revoke.status} in ${revoke.durationMs}ms`);
  console.log(JSON.stringify(revoke.body));

  heading("Token fetches after revocation");
  const windowMs = 60_000;
  summarise(await pollAfterRevoke(session.sessionId, windowMs, 2_000), windowMs);
}

async function revokeUserSessions(kindeUserId: string): Promise<void> {
  const session = loadSession();
  heading("Baseline: token before revocation");
  const before = await fetchConnectedAppToken(session.sessionId);
  console.log(
    before.ok
      ? `  issuing tokens (HTTP ${before.status})`
      : `  already refusing: HTTP ${before.status} ${before.reason}`,
  );
  if (!before.ok) {
    console.log("\nNothing to revoke. Relink first.");
    process.exitCode = 1;
    return;
  }

  heading(`DELETE /api/v1/users/${kindeUserId}/sessions`);
  const revoke = await deleteUserSessions(kindeUserId);
  console.log(`HTTP ${revoke.status} in ${revoke.durationMs}ms`);
  console.log(JSON.stringify(revoke.body));

  heading("Token fetches after revocation");
  const windowMs = 60_000;
  summarise(await pollAfterRevoke(session.sessionId, windowMs, 2_000), windowMs);

  console.log(
    "\nNow reload the app in the browser. If the user is signed out, this lever\nis too broad to be the kill switch.",
  );
}

/* ------------------------------------------------------------------ main -- */

async function main(): Promise<void> {
  const [command, arg] = process.argv.slice(2);

  switch (command) {
    case "link":
      if (!arg) throw new Error("Usage: npm run probe -- link <kindeUserId>");
      return await link(arg);
    case "token":
      return await token();
    case "github":
      return await github();
    case "sessions":
      if (!arg) throw new Error("Usage: npm run probe -- sessions <kindeUserId>");
      return await sessions(arg);
    case "revoke-session":
      return await revokeSession();
    case "revoke-user-sessions":
      if (!arg) {
        throw new Error(
          "Usage: npm run probe -- revoke-user-sessions <kindeUserId>",
        );
      }
      return await revokeUserSessions(arg);
    case "whoami": {
      // Confirms the M2M credentials work before anything else is attempted.
      const t = await getManagementToken();
      heading("Management token");
      console.log(`obtained: ${describeToken(t).length} chars, JWT=${describeToken(t).isJwt}`);
      return;
    }
    default:
      console.log(
        [
          "Commands:",
          "  whoami                            check the M2M credentials",
          "  link <kindeUserId>                get the GitHub authorization url",
          "  token                             fetch and describe a brokered token",
          "  github                            call GitHub with a brokered token",
          "  sessions <kindeUserId>            list the user's Kinde sessions",
          "  revoke-session                    revoke the connected app session, then measure",
          "  revoke-user-sessions <kindeUserId>  delete all user sessions, then measure",
        ].join("\n"),
      );
  }
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
