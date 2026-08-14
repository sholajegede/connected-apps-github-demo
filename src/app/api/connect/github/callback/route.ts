import { NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import { appEnv, kindeManagementEnv, storageMode } from "@/lib/env";
import { convexServerClient, convexServerSecret } from "@/lib/convex-server";
import { newCorrelationId } from "@/lib/correlation";
import { currentOperator } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where Kinde returns the user after they authorize GitHub.
 *
 * Kinde sends `session_id` here. That handle is what the broker later gives to
 * `connected_apps/token`. It is not a GitHub credential: it carries no access
 * on its own, it is useless without this app's Kinde M2M credentials, and
 * Kinde stops honouring it the instant the connection is revoked.
 *
 * No token arrives in this request, and none is stored.
 */
export async function GET(request: Request) {
  const base = appEnv().APP_BASE_URL;
  const url = new URL(request.url);
  const back = new URL("/console", base);

  if (url.searchParams.has("error")) {
    back.searchParams.set(
      "connectError",
      url.searchParams.get("error_description") ??
        url.searchParams.get("error") ??
        "The authorization did not complete.",
    );
    return NextResponse.redirect(back);
  }

  const operator = await currentOperator();
  if (!operator) return NextResponse.redirect(new URL("/", base));

  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) {
    back.searchParams.set(
      "connectError",
      "Kinde did not return a connected app session.",
    );
    return NextResponse.redirect(back);
  }

  const convex = convexServerClient();
  const secret = convexServerSecret();

  await convex.mutation(api.gateway.markLinked, {
    secret,
    userId: operator.userId,
    kindeConnectionId: kindeManagementEnv().KINDE_GITHUB_CONNECTED_APP_KEY,
    kindeSessionId: sessionId,
    grantedScopes: ["public_repo"],
  });

  await convex.mutation(api.gateway.recordAudit, {
    secret,
    correlationId: newCorrelationId(),
    userId: operator.userId,
    event: "connection.linked",
    outcome: "allowed",
    storageMode: storageMode(),
    detail: "GitHub connected through Kinde. The app stores no token.",
  });

  back.searchParams.set("connected", "1");
  return NextResponse.redirect(back);
}
