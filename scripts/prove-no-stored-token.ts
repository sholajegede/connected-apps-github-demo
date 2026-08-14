/**
 * Prove, at run time, that the app holds no GitHub credential.
 *
 * A comment in the source is not evidence. This script runs a real action
 * through the broker and then goes looking for a credential everywhere the app
 * could have put one:
 *
 *   1. Every row of every table in the Convex store.
 *   2. Everything the broker printed while it ran.
 *   3. The process environment.
 *
 * In connected-app mode every one of those must come back clean.
 *
 * In stored-key mode the environment check is EXPECTED to find the app's own
 * held token. That contrast is the point of the script — the same assertion,
 * run against the same code, passes in one mode and finds a credential in the
 * other.
 *
 * Exit code is non-zero when the mode's expectations are not met.
 *
 * Usage: npm run prove -- <kindeUserId>
 */

import "./load-env";

import { api } from "../convex/_generated/api";
import { brokerAction } from "../src/lib/broker/index";
import { convexServerClient, convexServerSecret } from "../src/lib/convex-server";
import { newCorrelationId } from "../src/lib/correlation";
import { storageMode } from "../src/lib/env";
import { CONNECTED_APP } from "../src/lib/storage-mode";

/**
 * Anything shaped like a GitHub credential. Deliberately broad: it matches
 * every GitHub token prefix, not only the one this demo expects.
 */
const CREDENTIAL_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "GitHub OAuth token (gho_)", pattern: /gho_[A-Za-z0-9]{16,}/ },
  { name: "GitHub PAT, classic (ghp_)", pattern: /ghp_[A-Za-z0-9]{16,}/ },
  { name: "GitHub user-to-server (ghu_)", pattern: /ghu_[A-Za-z0-9]{16,}/ },
  { name: "GitHub server-to-server (ghs_)", pattern: /ghs_[A-Za-z0-9]{16,}/ },
  { name: "GitHub refresh token (ghr_)", pattern: /ghr_[A-Za-z0-9]{16,}/ },
  {
    name: "GitHub fine-grained PAT",
    pattern: /github_pat_[A-Za-z0-9_]{20,}/,
  },
];

interface Finding {
  where: string;
  what: string;
}

function scan(where: string, text: string, into: Finding[]): void {
  for (const { name, pattern } of CREDENTIAL_PATTERNS) {
    if (pattern.test(text)) into.push({ where, what: name });
  }
}

function heading(text: string): void {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

/** Capture everything written to the console while `fn` runs. */
async function captureOutput<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; output: string }> {
  const lines: string[] = [];
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
  };
  const record =
    (next: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      lines.push(args.map((a) => String(a)).join(" "));
      next(...args);
    };

  console.log = record(original.log);
  console.warn = record(original.warn);
  console.error = record(original.error);
  console.info = record(original.info);
  console.debug = record(original.debug);

  try {
    return { result: await fn(), output: lines.join("\n") };
  } finally {
    Object.assign(console, original);
  }
}

async function main(): Promise<void> {
  const kindeUserId = process.argv[2];
  if (!kindeUserId) {
    throw new Error("Usage: npm run prove -- <kindeUserId>");
  }

  const mode = storageMode();
  const correlationId = newCorrelationId();

  heading("Setup");
  console.log(`storage mode   ${mode}`);
  console.log(`correlationId  ${correlationId}`);

  // 1. Run a real action through the broker, capturing everything it prints.
  heading("Step 1 — run a real action through the broker");
  const { result: outcome, output } = await captureOutput(() =>
    brokerAction({
      actionId: "read_issues",
      input: { state: "open", limit: 3 },
      kindeUserId,
      correlationId,
    }),
  );

  console.log(`outcome        ${outcome.status}`);
  if (outcome.status === "ok") {
    console.log(`summary        ${outcome.summary}`);
    console.log(`scopes         ${outcome.scopes.join(", ") || "(none)"}`);
  } else {
    console.log(`reason         ${outcome.reason}`);
  }

  if (outcome.status !== "ok") {
    console.log(
      "\nThe action did not succeed, so there is nothing to prove about it.",
    );
    process.exitCode = 1;
    return;
  }

  const findings: Finding[] = [];
  const envFindings: Finding[] = [];

  // 2. The store. Every row of every table, not just the ones expected to be
  //    interesting — an assertion that looks only where it expects proves
  //    nothing.
  heading("Step 2 — scan every row of every table in the store");
  const convex = convexServerClient();
  const dump = await convex.query(api.gateway.dumpAll, {
    secret: convexServerSecret(),
  });

  for (const [table, rows] of Object.entries(dump)) {
    const text = JSON.stringify(rows);
    scan(`store.${table}`, text, findings);
    console.log(`  ${table.padEnd(12)} ${rows.length} row(s) scanned`);
  }

  // 3. What the broker printed.
  heading("Step 3 — scan everything the broker printed");
  scan("broker output", output, findings);
  console.log(`  ${output.split("\n").filter(Boolean).length} line(s) scanned`);

  // 4. The process environment.
  heading("Step 4 — scan the process environment");
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && value) {
      scan(`env.${key}`, value, envFindings);
    }
  }
  console.log(`  ${Object.keys(process.env).length} variable(s) scanned`);

  // ------------------------------------------------------------- verdict --
  heading("Verdict");

  const storeAndLogs = findings;
  for (const finding of [...storeAndLogs, ...envFindings]) {
    console.log(`  FOUND  ${finding.what} in ${finding.where}`);
  }

  if (mode === CONNECTED_APP) {
    if (storeAndLogs.length === 0 && envFindings.length === 0) {
      console.log("\nCLEAN — connected-app mode.");
      console.log("The action succeeded and acted on a real repository.");
      console.log(
        "No GitHub credential is in the store, in the broker's output, or in\nthe environment. The app held a token for the length of one call and\ndropped it.",
      );
      return;
    }
    console.log(
      "\nFAILED — connected-app mode must hold no GitHub credential anywhere.",
    );
    process.exitCode = 1;
    return;
  }

  // stored-key mode.
  if (storeAndLogs.length > 0) {
    console.log(
      "\nFAILED — even stored-key mode must not write a credential into the\nstore or a log line. Only the environment may hold it.",
    );
    process.exitCode = 1;
    return;
  }
  if (envFindings.length === 0) {
    console.log(
      "\nFAILED — stored-key mode is supposed to hold a token in the\nenvironment, and no credential was found. Is GITHUB_STORED_TOKEN set?",
    );
    process.exitCode = 1;
    return;
  }

  console.log("\nAS EXPECTED — stored-key mode.");
  console.log(
    "The app holds a GitHub credential in its own environment. That is the\nhole this mode exists to demonstrate: the token is the app's, so revoking\nthe connection at Kinde does not reach it.",
  );
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
