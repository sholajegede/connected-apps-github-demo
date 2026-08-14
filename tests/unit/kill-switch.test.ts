import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The kill switch must use the lever that was measured to work, and must not
 * reach for the one that was measured to be a decoy.
 *
 * Measured on 2026-08-14:
 *   POST /connected_apps/revoke      next token fetch failed at +0ms
 *   DELETE /users/{id}/sessions      HTTP 200 USER_SESSIONS_INVALIDATED,
 *                                    then 23 successful token fetches over 60s
 *
 * A future edit that "simplifies" the kill switch onto the user-sessions
 * endpoint would produce a revoke path that reports success and stops
 * nothing. These tests exist to make that edit fail loudly.
 */

const ROOT = join(import.meta.dirname, "../..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.tsx?$/.test(path)) out.push(path);
  }
  return out;
}

const files = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "scripts"))].map(
  (path) => ({ path: relative(ROOT, path), text: readFileSync(path, "utf8") }),
);

const revokeModule = files.find(
  (file) => file.path === "src/lib/broker/revoke.ts",
);

describe("kill switch", () => {
  it("exists", () => {
    expect(revokeModule).toBeDefined();
  });

  it("uses the connected app revoke endpoint", () => {
    expect(revokeModule!.text).toMatch(/revokeConnectedAppSession\(/);
  });

  it("never calls the user-sessions endpoint", () => {
    expect(revokeModule!.text).not.toMatch(/deleteUserSessions/);
  });

  it("keeps the user-sessions call out of the whole application", () => {
    // It survives only in the probe, where it is the measurement that proved
    // the endpoint useless as a kill switch.
    const callers = files
      .filter(
        (file) =>
          file.path !== "src/lib/kinde/connected-apps.ts" &&
          file.text.includes("deleteUserSessions"),
      )
      .map((file) => file.path)
      .sort();

    expect(callers).toEqual(["scripts/kinde-probe.ts"]);
  });

  it("does not overclaim what revocation reaches", () => {
    const text = revokeModule!.text;
    // The honest framing has to survive in the source, because the copy is
    // derived from it.
    expect(text).toMatch(/DOES NOT/);
    expect(text).toMatch(/already issued|already handed out/i);
  });
});
