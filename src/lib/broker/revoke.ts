import { api } from "@convex/_generated/api";
import { revokeConnectedAppSession } from "@/lib/kinde/connected-apps";
import { convexServerClient, convexServerSecret } from "@/lib/convex-server";
import { storageMode } from "@/lib/env";

/**
 * The kill switch.
 *
 * It calls exactly one Kinde endpoint: `POST /connected_apps/revoke` with the
 * session handle. That is the lever that was measured to work — the next
 * `connected_apps/token` fetch failed at +0ms.
 *
 * It deliberately does NOT call `DELETE /users/{id}/sessions`. That endpoint
 * was measured returning HTTP 200 `USER_SESSIONS_INVALIDATED` while Kinde
 * carried on issuing tokens for a full 60 seconds across 23 attempts. It
 * reports success and stops nothing. `tests/unit/kill-switch.test.ts` asserts
 * this module never reaches for it.
 *
 * ── What revocation does and does not do ──────────────────────────────────
 *
 * DOES: stop Kinde brokering or refreshing any further token for this
 *       connection, immediately.
 *
 * DOES NOT: reach into GitHub and kill a token that was already issued. A
 *       token already handed out keeps working until it expires — measured
 *       still valid 37.6s after revocation, and its life is ~8 hours.
 *
 * So the cutoff in connected-app mode is instant *because the broker holds
 * nothing between actions*, not because revocation propagates to GitHub. In
 * stored-key mode the app holds its own token, so revocation reaches nothing
 * at all and the agent carries on.
 */

export interface RevocationRequest {
  kindeUserId: string;
  correlationId: string;
}

export type RevocationResult =
  | {
      status: "revoked";
      /** Round-trip time of the Kinde revoke call. */
      durationMs: number;
      httpStatus: number;
      /**
       * True when this deployment's mode means revocation actually cuts the
       * agent off. In stored-key mode it does not, and saying so is the point.
       */
      cutsOffAgent: boolean;
    }
  | { status: "nothing-to-revoke"; reason: string }
  | { status: "failed"; reason: string; httpStatus: number };

export async function revokeConnection(
  request: RevocationRequest,
): Promise<RevocationResult> {
  const mode = storageMode();
  const convex = convexServerClient();
  const secret = convexServerSecret();

  const audit = async (
    outcome: "allowed" | "refused" | "failed",
    detail: string,
    userId?: string,
  ) => {
    await convex.mutation(api.gateway.recordAudit, {
      secret,
      correlationId: request.correlationId,
      userId: userId as never,
      event: "connection.revoked",
      outcome,
      storageMode: mode,
      detail: detail.slice(0, 500),
    });
  };

  const { user, connection } = await convex.query(api.gateway.brokerContext, {
    secret,
    kindeUserId: request.kindeUserId,
  });

  if (!user || !connection?.kindeSessionId) {
    const reason = user
      ? "No connected app session for this user."
      : `No such user: ${request.kindeUserId}.`;
    await audit("refused", reason, user?._id);
    return { status: "nothing-to-revoke", reason };
  }

  const result = await revokeConnectedAppSession(connection.kindeSessionId);

  if (!result.ok) {
    const reason = `Kinde refused the revocation (HTTP ${result.status}).`;
    await audit("failed", reason, user._id);
    return { status: "failed", reason, httpStatus: result.status };
  }

  // Record the revocation locally too. The broker refuses on its own
  // authority once the connection reads `revoked`, rather than depending on
  // Kinde's refusal alone.
  await convex.mutation(api.gateway.markRevoked, { secret, userId: user._id });

  const cutsOffAgent = mode !== "stored-key";
  await audit(
    "allowed",
    cutsOffAgent
      ? "Connection revoked at Kinde. No further token will be brokered, so the next action is refused."
      : "Connection revoked at Kinde. The app holds its own token, so this does not stop the agent.",
    user._id,
  );

  return {
    status: "revoked",
    durationMs: result.durationMs,
    httpStatus: result.status,
    cutsOffAgent,
  };
}
