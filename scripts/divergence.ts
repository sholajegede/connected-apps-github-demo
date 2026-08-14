/**
 * The audit trail either side of a revocation.
 *
 * One table, ordered by time, showing what each mode did after the same
 * revocation. The correlationId column is what ties each row back to the run
 * that caused it.
 */
import "./load-env";
import { api } from "../convex/_generated/api";
import { convexServerClient } from "../src/lib/convex-server";

async function main(): Promise<void> {
  const convex = convexServerClient();
  const rows = await convex.query(api.audit.recent, { limit: 200 });
  const ordered = [...rows].sort((a, b) => a.at - b.at);

  const revoked = ordered.filter((r) => r.event === "connection.revoked").at(-1);
  if (!revoked) throw new Error("No revocation found in the audit log.");

  console.log(
    "\ntime (UTC)  mode           event              outcome   correlationId          detail",
  );
  console.log("-".repeat(150));

  for (const row of ordered) {
    if (row.at < revoked.at - 240_000) continue;
    const marker = row.at === revoked.at ? " <== REVOKE" : "";
    const time = new Date(row.at).toISOString().slice(11, 19);
    console.log(
      `${time}    ${row.storageMode.padEnd(14)} ${row.event.padEnd(18)} ${row.outcome.padEnd(9)} ${row.correlationId.slice(0, 20)}  ${(row.detail ?? "").slice(0, 60)}${marker}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
