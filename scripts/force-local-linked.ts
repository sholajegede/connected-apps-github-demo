/**
 * Force the LOCAL connection flag back to `linked` without touching Kinde.
 *
 * This exists to separate the two layers of the cutoff. After a revocation the
 * broker refuses on its own authority because the stored status reads
 * `revoked`. That is deliberate defence in depth — but it means a run does not
 * prove that Kinde is refusing too.
 *
 * Running this puts the local flag back to `linked` while the Kinde session
 * stays revoked, so the next broker call must reach Kinde and be refused there
 * with INVALID_SESSION. It is a test instrument, not part of the app.
 */
import "./load-env";
import { readFileSync } from "node:fs";
import { api } from "../convex/_generated/api";
import { convexServerClient, convexServerSecret } from "../src/lib/convex-server";

async function main(): Promise<void> {
  const kindeUserId = process.argv[2];
  if (!kindeUserId) throw new Error("Usage: tsx scripts/force-local-linked.ts <kindeUserId>");

  const session = JSON.parse(readFileSync(".kinde-session.json", "utf8")) as {
    sessionId: string;
  };
  const convex = convexServerClient();
  const secret = convexServerSecret();

  const { user } = await convex.query(api.gateway.brokerContext, {
    secret,
    kindeUserId,
  });
  if (!user) throw new Error(`No such user: ${kindeUserId}`);

  await convex.mutation(api.gateway.markLinked, {
    secret,
    userId: user._id,
    kindeConnectionId: process.env.KINDE_GITHUB_CONNECTED_APP_KEY ?? "github",
    kindeSessionId: session.sessionId,
    grantedScopes: ["public_repo"],
  });

  console.log(`local flag forced to linked; Kinde session ${session.sessionId} remains revoked`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
