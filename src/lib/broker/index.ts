import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { getHandler } from "@/lib/actions/handlers";
import { getAction, parseActionInput, type ActionId } from "@/lib/actions/registry";
import { convexServerClient, convexServerSecret } from "@/lib/convex-server";
import { gitHubTargetEnv, storageMode } from "@/lib/env";
import { createGitHubClient } from "@/lib/github/client";
import { CONNECTED_APP, STORED_KEY } from "@/lib/storage-mode";
import {
  acquireConnectedAppToken,
  acquireStoredKeyToken,
  type CredentialResult,
} from "./credential";

/**
 * The token broker.
 *
 * Every GitHub action in this application passes through this one function.
 * Nothing else obtains a credential and nothing else calls GitHub.
 *
 * What the broker guarantees:
 *
 *   - The storage mode is read from the deployment environment here, on the
 *     server. No argument to this function can influence it.
 *   - In connected-app mode a token is fetched for this one action and is
 *     dropped when the function returns. It is never persisted and never
 *     logged.
 *   - The token is never returned to the caller. Callers receive a result;
 *     the agent receives a result. Neither ever sees a credential.
 *   - No token from Kinde means the action is refused. A refusal is a
 *     recorded outcome, not a thrown error.
 *   - Every attempt writes an audit row carrying the correlationId.
 */

export interface BrokerRequest {
  actionId: string;
  input: unknown;
  /** The signed-in user, by Kinde subject. */
  kindeUserId: string;
  correlationId: string;
  runId?: Id<"runs">;
}

export type BrokerOutcome =
  | {
      status: "ok";
      actionId: ActionId;
      storageMode: string;
      summary: string;
      data: unknown;
      actingLogin: string | null;
      scopes: string[];
    }
  | {
      status: "refused";
      actionId: string;
      storageMode: string;
      reason: string;
    }
  | {
      status: "failed";
      actionId: string;
      storageMode: string;
      reason: string;
    };

/** Never let a credential reach an audit row or a log line. */
const CREDENTIAL_PATTERN =
  /gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}/g;

export function redactCredentials(text: string): string {
  return text.replace(CREDENTIAL_PATTERN, "[redacted]");
}

export async function brokerAction(
  request: BrokerRequest,
): Promise<BrokerOutcome> {
  // Server-decided. Read here, from the environment, and nowhere else.
  const mode = storageMode();
  const convex = convexServerClient();
  const secret = convexServerSecret();

  const audit = async (
    event:
      | "token.brokered"
      | "token.refused"
      | "action.invoked"
      | "action.refused",
    outcome: "allowed" | "refused" | "failed",
    detail?: string,
    userId?: Id<"users">,
  ) => {
    await convex.mutation(api.gateway.recordAudit, {
      secret,
      correlationId: request.correlationId,
      userId,
      runId: request.runId,
      event,
      outcome,
      actionId: request.actionId,
      storageMode: mode,
      detail: detail ? redactCredentials(detail).slice(0, 500) : undefined,
    });
  };

  // 1. The action must be in the registry. Anything else is refused before
  //    a credential is even considered.
  let action;
  let input;
  try {
    action = getAction(request.actionId);
    input = parseActionInput(action.id, request.input);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await audit("action.refused", "refused", reason);
    return {
      status: "refused",
      actionId: request.actionId,
      storageMode: mode,
      reason,
    };
  }

  // 2. Look up who is acting. connected-app mode needs the connection state;
  //    stored-key mode deliberately does not.
  const { user, connection } = await convex.query(api.gateway.brokerContext, {
    secret,
    kindeUserId: request.kindeUserId,
  });

  if (!user) {
    const reason = `No such user: ${request.kindeUserId}. Refusing to act.`;
    await audit("action.refused", "refused", reason);
    return { status: "refused", actionId: action.id, storageMode: mode, reason };
  }

  // 3. Get a credential. This is the only place either mode obtains one.
  let credential: CredentialResult;
  if (mode === STORED_KEY) {
    // Note what is absent: no Kinde call, no connection status check. The app
    // holds this token, so revocation at Kinde cannot reach it.
    credential = acquireStoredKeyToken();
  } else {
    credential = await acquireConnectedAppToken({
      kindeSessionId: connection?.kindeSessionId,
      status: connection?.status ?? "unlinked",
    });
  }

  if (!credential.ok) {
    await audit("token.refused", "refused", credential.reason, user._id);
    return {
      status: "refused",
      actionId: action.id,
      storageMode: mode,
      reason: credential.reason,
    };
  }

  await audit(
    "token.brokered",
    "allowed",
    mode === CONNECTED_APP
      ? "Fetched a token from Kinde for one action. Not stored."
      : "Used the token the app holds. Kinde was not consulted.",
    user._id,
  );

  // 4. Act. The handler is given a bound caller, never the token.
  const target = gitHubTargetEnv();
  const call = createGitHubClient(credential.token);
  const handler = getHandler(action.id);

  try {
    const result = await handler(
      call,
      input as never,
      { owner: target.GITHUB_TARGET_OWNER, repo: target.GITHUB_TARGET_REPO },
    );

    if (mode === CONNECTED_APP && connection) {
      await convex.mutation(api.gateway.noteBrokered, {
        secret,
        connectionId: connection._id,
        githubLogin: result.actingUser?.login,
      });
    }

    await audit("action.invoked", "allowed", result.summary, user._id);

    return {
      status: "ok",
      actionId: action.id,
      storageMode: mode,
      summary: result.summary,
      data: result.data,
      actingLogin: result.actingUser?.login ?? null,
      scopes: result.scopes,
    };
  } catch (error) {
    const reason = redactCredentials(
      error instanceof Error ? error.message : String(error),
    );
    await audit("action.invoked", "failed", reason, user._id);
    return { status: "failed", actionId: action.id, storageMode: mode, reason };
  }
  // The token goes out of scope here. Nothing wrote it anywhere.
}
