import { handleAuth } from "@kinde-oss/kinde-auth-nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The user's own session with this app: login, logout, callback.
 *
 * This is entirely separate from the GitHub connection. Revoking the GitHub
 * connection must not touch it — that is the property the console demonstrates.
 */
export const GET = handleAuth();
