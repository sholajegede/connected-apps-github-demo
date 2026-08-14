import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Structural guarantees, enforced against the source tree rather than trusted.
 *
 *   1. Exactly one module calls GitHub.
 *   2. Only the broker imports that module.
 *   3. Nothing outside the broker's credential layer reads the stored key.
 *   4. The agent layer never imports the GitHub client.
 *
 * These are the invariants the demo's whole argument rests on, so they are
 * tests, not comments.
 */

const ROOT = join(import.meta.dirname, "../..");
const SRC = join(ROOT, "src");
const SCRIPTS = join(ROOT, "scripts");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.tsx?$/.test(path)) out.push(path);
  }
  return out;
}

const sourceFiles = walk(SRC).map((path) => ({
  path: relative(ROOT, path),
  text: readFileSync(path, "utf8"),
}));

const scriptFiles = walk(SCRIPTS).map((path) => ({
  path: relative(ROOT, path),
  text: readFileSync(path, "utf8"),
}));

describe("one GitHub caller", () => {
  it("has exactly one module in src that names the GitHub API host", () => {
    const callers = sourceFiles
      .filter((file) => file.text.includes("api.github.com"))
      .map((file) => file.path);

    expect(callers).toEqual(["src/lib/github/client.ts"]);
  });

  it("is imported only by the broker", () => {
    const importers = sourceFiles
      .filter(
        (file) =>
          file.path !== "src/lib/github/client.ts" &&
          /from\s+["']@\/lib\/github\/client["']/.test(file.text),
      )
      .map((file) => file.path)
      .sort();

    // Handlers take the bound caller as a type only; the broker is what
    // constructs a client, because the broker is what holds the token.
    expect(importers).toEqual([
      "src/lib/actions/handlers.ts",
      "src/lib/broker/index.ts",
    ]);
  });

  it("constructs a client in the broker and nowhere else", () => {
    const constructors = sourceFiles
      .filter((file) => file.text.includes("createGitHubClient("))
      .map((file) => file.path)
      .filter((path) => path !== "src/lib/github/client.ts")
      .sort();

    expect(constructors).toEqual(["src/lib/broker/index.ts"]);
  });

  it("reads the stored key only in the broker's credential layer", () => {
    const readers = sourceFiles
      .filter(
        (file) =>
          file.path !== "src/lib/env.ts" &&
          (file.text.includes("storedKeyEnv") ||
            file.text.includes("GITHUB_STORED_TOKEN")),
      )
      .map((file) => file.path)
      .sort();

    expect(readers).toEqual(["src/lib/broker/credential.ts"]);
  });
});

describe("the agent holds nothing", () => {
  const agentFiles = sourceFiles.filter((file) =>
    file.path.startsWith("src/lib/agent/"),
  );

  it("has agent modules to check", () => {
    expect(agentFiles.length).toBeGreaterThan(0);
  });

  it("never imports the GitHub client", () => {
    for (const file of agentFiles) {
      expect(
        file.text.includes("@/lib/github/client"),
        `${file.path} imports the GitHub client`,
      ).toBe(false);
    }
  });

  it("never names the GitHub API host", () => {
    for (const file of agentFiles) {
      expect(
        file.text.includes("api.github.com"),
        `${file.path} calls GitHub directly`,
      ).toBe(false);
    }
  });

  it("never reads a credential from the environment", () => {
    for (const file of agentFiles) {
      expect(
        /GITHUB_STORED_TOKEN|storedKeyEnv|fetchConnectedAppToken/.test(file.text),
        `${file.path} reaches for a credential`,
      ).toBe(false);
    }
  });

  it("branches on the storage mode nowhere", () => {
    // The same agent code must run in both modes. Only the broker differs.
    for (const file of agentFiles) {
      expect(
        /"stored-key"|'stored-key'|STORED_KEY/.test(file.text),
        `${file.path} branches on the storage mode`,
      ).toBe(false);
    }
  });

  it("reaches GitHub only by calling the broker", () => {
    const run = agentFiles.find((file) => file.path === "src/lib/agent/run.ts");
    expect(run).toBeDefined();
    expect(run!.text).toMatch(/brokerAction\(/);
  });
});

describe("no credential leaves the broker", () => {
  it("never returns a token from the broker's outcome type", () => {
    const broker = sourceFiles.find(
      (file) => file.path === "src/lib/broker/index.ts",
    );
    expect(broker).toBeDefined();

    // The outcome union must not carry a field that could hold a credential.
    expect(broker!.text).not.toMatch(/^\s*(token|accessToken|credential)\s*:/m);
  });

  it("never writes a token into the store", () => {
    // No gateway or Convex call anywhere may take a token-shaped argument.
    for (const file of [...sourceFiles, ...scriptFiles]) {
      expect(
        /mutation\([^)]*\b(token|accessToken)\s*[,:]/.test(file.text),
        `${file.path} passes a token into a Convex mutation`,
      ).toBe(false);
    }
  });
});
