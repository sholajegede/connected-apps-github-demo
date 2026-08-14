import { NextResponse } from "next/server";
import { getConnectedAppAuthUrl } from "@/lib/kinde/connected-apps";
import { appEnv } from "@/lib/env";
import { currentOperator } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start the GitHub connection.
 *
 * Asks Kinde for an authorization URL for this specific user and sends them to
 * it. Nothing sensitive is created here: the session handle comes back on the
 * callback, and the credential itself never touches this app at all.
 */
export async function GET() {
  const operator = await currentOperator();
  if (!operator) {
    return NextResponse.redirect(new URL("/", appEnv().APP_BASE_URL));
  }

  try {
    const { url } = await getConnectedAppAuthUrl({
      kindeUserId: operator.kindeUserId,
    });
    return NextResponse.redirect(url, { status: 302 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    const back = new URL("/console", appEnv().APP_BASE_URL);
    back.searchParams.set("connectError", reason);
    return NextResponse.redirect(back);
  }
}
