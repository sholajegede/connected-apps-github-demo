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
 * Usage:
 *   npm run prove -- <kindeUserId>           scan around a direct broker call
 *   npm run prove -- <kindeUserId> agent     scan around a full agent run
 */

import "./load-env";

import { api } from "../convex/_generated/api";
import { brokerAction } from "../src/lib/broker/index";
import { runAgent } from "../src/lib/agent/run";
import { convexServerClient, convexServerSecret } from "../src/lib/convex-server";
import { newCorrelationId } from "../src/lib/correlation";
import { storageMode } from "../src/lib/env";
import { CONNECTED_APP } from "../src/lib/storage-mode";
import { scan, type Finding } from "./credential-scan";

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
    throw new Error("Usage: npm run prove -- <kindeUserId> [agent]");
  }

  const mode = storageMode();
  const correlationId = newCorrelationId();

  heading("Setup");
  console.log(`storage mode   ${mode}`);
  console.log(`correlationId  ${correlationId}`);

  // 1. Do real work, capturing everything printed while it happens.
  //
  //    `agent` runs the full OpenAI loop, so the scan covers the agent path
  //    end to end: the model, its tool calls, the broker beneath them and
  //    everything they wrote. `broker` exercises the broker alone.
  const viaAgent = process.argv[3] === "agent";

  heading(
    viaAgent
      ? "Step 1 — run a real agent task through the broker"
      : "Step 1 — run a real action through the broker",
  );

  let succeeded = false;
  let output = "";

  if (viaAgent) {
    const convex0 = convexServerClient();
    const { user } = await convex0.query(api.gateway.brokerContext, {
      secret: convexServerSecret(),
      kindeUserId,
    });
    if (!user) throw new Error(`No such user: ${kindeUserId}.`);

    const captured = await captureOutput(() =>
      runAgent({
        kindeUserId,
        userId: user._id,
        goal: "Read the open issues and post a short useful comment on the most actionable one.",
        correlationId,
      }),
    );
    output = captured.output;

    console.log(`status         ${captured.result.status}`);
    console.log(`runId          ${captured.result.runId}`);
    for (const call of captured.result.toolCalls) {
      console.log(`tool           ${call.actionId} -> ${call.outcome}`);
    }
    succeeded = captured.result.status === "succeeded";

    // The agent's own output is part of what must be clean: if a token ever
    // reached the model, it could surface in the transcript.
    output += `\n${captured.result.finalMessage}\n${JSON.stringify(captured.result.toolCalls)}`;
  } else {
    const captured = await captureOutput(() =>
      brokerAction({
        actionId: "read_issues",
        input: { state: "open", limit: 3 },
        kindeUserId,
        correlationId,
      }),
    );
    output = captured.output;
    const outcome = captured.result;

    console.log(`outcome        ${outcome.status}`);
    if (outcome.status === "ok") {
      console.log(`summary        ${outcome.summary}`);
      console.log(`scopes         ${outcome.scopes.join(", ") || "(none)"}`);
    } else {
      console.log(`reason         ${outcome.reason}`);
    }
    succeeded = outcome.status === "ok";
  }

  if (!succeeded) {
    console.log(
      "\nThe work did not succeed, so there is nothing to prove about it.",
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
