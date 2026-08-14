/**
 * Run the agent from the command line.
 *
 * Usage:
 *   npm run agent -- <kindeUserId> "<task>"
 *   npm run agent -- timeline <runId>
 */

import "./load-env";

import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { runAgent } from "../src/lib/agent/run";
import { convexServerClient, convexServerSecret } from "../src/lib/convex-server";
import { storageMode } from "../src/lib/env";

function heading(text: string): void {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

const DEFAULT_TASK =
  "Look at the open issues in the repository, pick the one you can help with most concretely, and post a short, useful comment on it.";

async function timeline(runId: string): Promise<void> {
  const convex = convexServerClient();
  const events = await convex.query(api.runs.events, {
    runId: runId as Id<"runs">,
  });

  heading(`Timeline for ${runId}`);
  for (const event of events) {
    const correlation =
      event.data && typeof event.data === "object" && "correlationId" in event.data
        ? String((event.data as { correlationId: unknown }).correlationId)
        : event.correlationId;
    console.log(
      `  ${String(event.seq).padStart(2)}  ${event.type.padEnd(22)} ${correlation}\n      ${event.message}`,
    );
  }
}

async function run(kindeUserId: string, task: string): Promise<void> {
  const convex = convexServerClient();
  const secret = convexServerSecret();

  const { user } = await convex.query(api.gateway.brokerContext, {
    secret,
    kindeUserId,
  });
  if (!user) {
    throw new Error(
      `No such user: ${kindeUserId}. Run \`npm run broker -- connect ${kindeUserId}\` first.`,
    );
  }

  heading("Agent run");
  console.log(`storage mode   ${storageMode()}`);
  console.log(`task           ${task}`);

  const result = await runAgent({
    kindeUserId,
    userId: user._id,
    goal: task,
  });

  console.log(`\nrunId          ${result.runId}`);
  console.log(`correlationId  ${result.correlationId}`);
  console.log(`status         ${result.status}`);

  heading("Tool calls, all through the broker");
  if (result.toolCalls.length === 0) {
    console.log("  (none)");
  }
  for (const call of result.toolCalls) {
    console.log(`  ${call.actionId.padEnd(16)} ${call.outcome.padEnd(9)} ${call.detail}`);
  }

  heading("Agent's closing message");
  console.log(result.finalMessage || "(none)");

  await timeline(result.runId);

  if (result.status !== "succeeded") process.exitCode = 1;
}

async function main(): Promise<void> {
  const [first, second] = process.argv.slice(2);

  if (first === "timeline") {
    if (!second) throw new Error("Usage: npm run agent -- timeline <runId>");
    return await timeline(second);
  }
  if (!first) {
    throw new Error('Usage: npm run agent -- <kindeUserId> "<task>"');
  }
  return await run(first, second || DEFAULT_TASK);
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
