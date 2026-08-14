import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { redactCredentials } from "@/lib/broker";
import { describeToken } from "@/lib/kinde/token-shape";

/**
 * Token hygiene, checked against the source rather than trusted.
 *
 * The security property of connected-app mode is that the app holds nothing
 * between actions. A cache — of any lifetime — would reintroduce a window of
 * access that survives revocation, because a token already issued keeps
 * working at GitHub (measured: still valid 37.6s after revoke, life ~8h).
 * That is why this is a test and not a convention.
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

const src = walk(join(ROOT, "src")).map((path) => ({
  path: relative(ROOT, path),
  text: readFileSync(path, "utf8"),
}));

const broker = src.find((f) => f.path === "src/lib/broker/index.ts")!;
const credential = src.find((f) => f.path === "src/lib/broker/credential.ts")!;

describe("no token is cached", () => {
  it("keeps the token in a local, not module scope", () => {
    // A module-level binding is how a cache would appear. The token must only
    // ever live inside the function that fetched it.
    for (const file of [broker, credential]) {
      const moduleLevel = file.text
        .split("\n")
        .filter((line) => /^(let|var|const)\s/.test(line))
        .filter((line) => /token|credential/i.test(line))
        // Type aliases and imported helpers are not storage.
        .filter((line) => !/^const\s+(CREDENTIAL_PATTERN|.*Schema)\s*=/.test(line));

      expect(
        moduleLevel,
        `${file.path} declares module-level token state: ${moduleLevel.join(" | ")}`,
      ).toEqual([]);
    }
  });

  it("uses no cache primitives in the credential path", () => {
    for (const file of [broker, credential]) {
      expect(file.text).not.toMatch(/new Map\(|new WeakMap\(|globalThis\./);
      expect(file.text).not.toMatch(/unstable_cache|react\.cache|memoize/i);
    }
  });

  it("never revalidates or caches a Kinde or GitHub request", () => {
    const network = src.filter(
      (f) =>
        f.path === "src/lib/kinde/management.ts" ||
        f.path === "src/lib/github/client.ts",
    );
    expect(network.length).toBe(2);
    for (const file of network) {
      expect(file.text).toMatch(/cache:\s*"no-store"/);
      expect(file.text).not.toMatch(/next:\s*\{\s*revalidate/);
    }
  });
});

describe("no token is logged", () => {
  it("logs no interpolated token anywhere", () => {
    for (const file of src) {
      const logs = file.text
        .split("\n")
        .filter((line) => /console\.(log|error|warn|info|debug)/.test(line));
      for (const line of logs) {
        expect(
          /\$\{[^}]*\b(token|accessToken|credential\.token|secret)\b[^}]*\}/i.test(
            line,
          ),
          `${file.path} logs a credential: ${line.trim()}`,
        ).toBe(false);
      }
    }
  });

  it("redacts every GitHub token shape from any text it records", () => {
    const samples = [
      `failed with gho_${"a".repeat(36)}`,
      `failed with ghp_${"b".repeat(36)}`,
      `failed with ghu_${"c".repeat(36)}`,
      `failed with ghs_${"d".repeat(36)}`,
      `failed with ghr_${"e".repeat(36)}`,
      `failed with github_pat_${"f".repeat(30)}`,
    ];
    for (const sample of samples) {
      const redacted = redactCredentials(sample);
      expect(redacted).toContain("[redacted]");
      expect(redacted).not.toMatch(/gh[pousr]_[A-Za-z0-9]{16,}/);
      expect(redacted).not.toMatch(/github_pat_[A-Za-z0-9_]{16,}/);
    }
  });

  it("describes a token by fingerprint without revealing it", () => {
    const token = `gho_${"z".repeat(36)}`;
    const shape = describeToken(token);

    expect(shape.kind).toBe("gho_");
    expect(shape.length).toBe(40);
    expect(shape.fingerprint).toHaveLength(12);
    // The fingerprint must not contain the token, and must be stable.
    expect(token).not.toContain(shape.fingerprint);
    expect(describeToken(token).fingerprint).toBe(shape.fingerprint);
    expect(describeToken(`gho_${"y".repeat(36)}`).fingerprint).not.toBe(
      shape.fingerprint,
    );
  });
});

describe("fail closed on an outage", () => {
  it("gives every outbound call a deadline", () => {
    const management = src.find(
      (f) => f.path === "src/lib/kinde/management.ts",
    )!;
    const github = src.find((f) => f.path === "src/lib/github/client.ts")!;
    expect(management.text).toMatch(/AbortSignal\.timeout/);
    expect(github.text).toMatch(/AbortSignal\.timeout/);
  });

  it("wraps credential acquisition so nothing escapes unaudited", () => {
    // The acquisition step must sit inside a try block that audits and refuses.
    const acquisition = broker.text.slice(
      broker.text.indexOf("// 3. Get a credential"),
      broker.text.indexOf("// 4."),
    );
    expect(acquisition).toMatch(/try\s*\{/);
    expect(acquisition).toMatch(/audit\("token\.refused"/);
    expect(acquisition).toMatch(/refusal: "credential"/);
  });

  it("refuses when the decision cannot be recorded", () => {
    expect(broker.text).toMatch(/if \(!recorded\)/);
    expect(broker.text).toMatch(/Refusing to act rather than act without a record/);
  });
});
