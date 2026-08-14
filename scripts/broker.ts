/**
 * Drive the broker from the command line.
 *
 * This is how Phase 3 is checked live, before an agent exists to do it. Every
 * call here goes through the same `brokerAction` the agent will use later —
 * there is no second path to GitHub.
 *
 * Usage:
 *   npm run broker -- connect <kindeUserId>          link the saved session
 *   npm run broker -- act <kindeUserId> <actionId> '<json>'
 *   npm run broker -- revoke <kindeUserId>
 *   npm run broker -- audit <correlationId>
 */

import "./load-env";

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { api } from "../convex/_generated/api";
import { brokerAction } from "../src/lib/broker/index";
import { revokeConnection } from "../src/lib/broker/revoke";
import { convexServerClient, convexServerSecret } from "../src/lib/convex-server";
import { newCorrelationId } from "../src/lib/correlation";
import { listActions } from "../src/lib/actions/registry";
import { storageMode } from "../src/lib/env";

const SESSION_FILE = resolve(process.cwd(), ".kinde-session.json");

function heading(text: string): void {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

/**
 * Register the user and their connection in the store, taking the connected
 * app session handle from the probe's local scratch file.
 *
 * The handle is a Kinde session id, not a GitHub credential.
 */
async function connect(kindeUserId: string): Promise<void> {
  if (!existsSync(SESSION_FILE)) {
    throw new Error(
      "No connected app session on disk. Run `npm run probe -- link <kindeUserId>` and authorize first.",
    );
  }
  const session = JSON.parse(readFileSync(SESSION_FILE, "utf8")) as {
    sessionId: string;
    kindeUserId: string;
  };

  const convex = convexServerClient();
  const secret = convexServerSecret();

  heading("Register the user and the connection");
  const userId = await convex.mutation(api.gateway.upsertUser, {
    secret,
    kindeUserId,
  });
  const connectionId = await convex.mutation(api.gateway.markLinked, {
    secret,
    userId,
    kindeConnectionId: process.env.KINDE_GITHUB_CONNECTED_APP_KEY ?? "github",
    kindeSessionId: session.sessionId,
    grantedScopes: ["public_repo"],
  });

  await convex.mutation(api.gateway.syncCatalog, {
    secret,
    entries: listActions().map((action) => ({
      actionId: action.id,
      title: action.title,
      description: action.description,
      effect: action.effect,
      actsAsUser: action.actsAsUser,
      requiredScopes: [...action.requiredScopes],
    })),
  });

  console.log(`user        ${userId}`);
  console.log(`connection  ${connectionId}`);
  console.log(`session     ${session.sessionId}`);
  console.log(`catalogue   ${listActions().length} action(s) synced`);
}

async function act(
  kindeUserId: string,
  actionId: string,
  rawInput: string | undefined,
): Promise<void> {
  const correlationId = newCorrelationId();
  const input = rawInput ? JSON.parse(rawInput) : {};

  heading(`Broker ${actionId}`);
  console.log(`storage mode   ${storageMode()}`);
  console.log(`correlationId  ${correlationId}`);

  const outcome = await brokerAction({
    actionId,
    input,
    kindeUserId,
    correlationId,
  });

  console.log(`\noutcome        ${outcome.status}`);
  if (outcome.status === "ok") {
    console.log(`summary        ${outcome.summary}`);
    console.log(`acting as      ${outcome.actingLogin ?? "(not reported)"}`);
    console.log(`scopes         ${outcome.scopes.join(", ") || "(none)"}`);
    console.log(`data           ${JSON.stringify(outcome.data)}`);
  } else {
    console.log(`reason         ${outcome.reason}`);
    process.exitCode = 1;
  }

  await showAudit(correlationId);
}

/**
 * Revoke the user's GitHub connection.
 *
 * Uses `connected_apps/revoke` only. The user-sessions endpoint is not a kill
 * switch — it reports success and keeps issuing tokens.
 */
async function revoke(kindeUserId: string): Promise<void> {
  const correlationId = newCorrelationId();

  heading("Revoke the GitHub connection");
  console.log(`storage mode   ${storageMode()}`);
  console.log(`correlationId  ${correlationId}`);

  const result = await revokeConnection({ kindeUserId, correlationId });

  if (result.status === "revoked") {
    console.log(`\nHTTP           ${result.httpStatus} in ${result.durationMs}ms`);
    console.log(
      `effect         ${
        result.cutsOffAgent
          ? "Kinde will broker no further token. The next action is refused."
          : "NONE on the agent. The app holds its own token, so it keeps acting."
      }`,
    );
    console.log(
      "\nRevocation stops Kinde brokering or refreshing tokens. It does not\nreach into GitHub to kill a token already issued.",
    );
  } else {
    console.log(`\nstatus         ${result.status}`);
    console.log(`reason         ${result.reason}`);
    process.exitCode = 1;
  }

  await showAudit(correlationId);
}

async function showAudit(correlationId: string): Promise<void> {
  const convex = convexServerClient();
  const rows = await convex.query(api.audit.byCorrelationId, { correlationId });

  heading(`Audit trail for ${correlationId}`);
  if (rows.length === 0) {
    console.log("  (no rows)");
    return;
  }
  for (const row of rows) {
    console.log(
      `  ${new Date(row.at).toISOString()}  ${row.event.padEnd(18)} ${row.outcome.padEnd(8)} ${row.storageMode.padEnd(14)} ${row.detail ?? ""}`,
    );
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "connect":
      if (!rest[0]) throw new Error("Usage: npm run broker -- connect <kindeUserId>");
      return await connect(rest[0]);
    case "act":
      if (!rest[0] || !rest[1]) {
        throw new Error(
          "Usage: npm run broker -- act <kindeUserId> <actionId> '<json>'",
        );
      }
      return await act(rest[0], rest[1], rest[2]);
    case "revoke":
      if (!rest[0]) throw new Error("Usage: npm run broker -- revoke <kindeUserId>");
      return await revoke(rest[0]);
    case "audit":
      if (!rest[0]) throw new Error("Usage: npm run broker -- audit <correlationId>");
      return await showAudit(rest[0]);
    default:
      console.log(
        [
          "Commands:",
          "  connect <kindeUserId>                     register user + connection",
          "  act <kindeUserId> <actionId> '<json>'     run one action through the broker",
          "  revoke <kindeUserId>                      revoke the github connection",
          "  audit <correlationId>                     show the audit rows",
          "",
          `Actions: ${listActions().map((a) => a.id).join(", ")}`,
        ].join("\n"),
      );
  }
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
