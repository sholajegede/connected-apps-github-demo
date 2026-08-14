/**
 * The whole story, end to end, in one pass.
 *
 * Every step asserts the real outcome against the real services. Nothing is
 * mocked: real Kinde, real OpenAI, real GitHub, real comments on a real
 * repository. Any failed assertion exits non-zero and names what failed.
 *
 * The story:
 *
 *   1. Clean slate           the app keeps no credential; counters at zero
 *   2. connected-app acts    a real comment lands, nothing is kept
 *   3. connected-app revoked the next action is refused within one action
 *   4. stored-key acts       after the SAME revocation, it still comments
 *   5. reconciliation        one coherent trail across both modes
 *
 * Step 4 is the load-bearing negative. It must hold. If a held token ever
 * stopped working after revocation, the demo's honest framing would be wrong
 * and this script must go red.
 *
 * ── On running two modes in one pass ──────────────────────────────────────
 *
 * The storage mode is a deployment decision, read from the environment. To
 * keep that true, each acting step runs in a CHILD PROCESS with its own
 * STORAGE_MODE, exactly as a separate deployment would. This script never
 * mutates the mode in its own process, because doing so would quietly
 * contradict the property it is testing.
 *
 * Usage:
 *   npm run narrative -- <kindeUserId>
 *   npm run narrative -- actor <goal>      (internal: the child process)
 */

import "./load-env";

import { spawn } from "node:child_process";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { runAgent, type AgentRunResult } from "../src/lib/agent/run";
import { revokeConnection } from "../src/lib/broker/revoke";
import { convexServerClient, convexServerSecret } from "../src/lib/convex-server";
import { newCorrelationId } from "../src/lib/correlation";
import { gitHubTargetEnv, storageMode } from "../src/lib/env";
import { getUserSessions } from "../src/lib/kinde/connected-apps";
import { scanEnvironment, scanStore, type Finding } from "./credential-scan";

/* ------------------------------------------------------------ assertions -- */

interface Failure {
  step: string;
  what: string;
  detail: string;
}

const failures: Failure[] = [];
let currentStep = "setup";

function step(name: string): void {
  currentStep = name;
  console.log(`\n${name}\n${"─".repeat(name.length)}`);
}

function assert(what: string, ok: boolean, detail: string): boolean {
  if (ok) {
    console.log(`  PASS  ${what}`);
    console.log(`        ${detail}`);
  } else {
    console.log(`  FAIL  ${what}`);
    console.log(`        ${detail}`);
    failures.push({ step: currentStep, what, detail });
  }
  return ok;
}

function note(text: string): void {
  console.log(`  note  ${text}`);
}

function fatal(message: string): never {
  console.error(`\nThe narrative cannot continue: ${message}`);
  process.exit(1);
}

/* ------------------------------------------------------- the child actor -- */

interface ActorResult {
  storageMode: string;
  run: AgentRunResult;
}

/**
 * Run one agent task in a child process whose environment sets the mode.
 *
 * The child inherits this process's environment and then overrides
 * STORAGE_MODE, so it behaves exactly as a deployment configured that way.
 */
function actInMode(
  mode: "connected-app" | "stored-key",
  kindeUserId: string,
  goal: string,
): Promise<ActorResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      [
        "tsx",
        "--tsconfig",
        "tsconfig.scripts.json",
        "scripts/e2e-narrative.ts",
        "actor",
        kindeUserId,
        goal,
      ],
      {
        env: { ...process.env, STORAGE_MODE: mode },
        cwd: process.cwd(),
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));

    child.on("close", () => {
      const marker = stdout.lastIndexOf("__ACTOR_RESULT__");
      if (marker === -1) {
        reject(
          new Error(
            `The ${mode} actor returned no result.\nstdout: ${stdout.slice(-800)}\nstderr: ${stderr.slice(-800)}`,
          ),
        );
        return;
      }
      try {
        resolve(
          JSON.parse(stdout.slice(marker + "__ACTOR_RESULT__".length).trim()) as ActorResult,
        );
      } catch (error) {
        reject(
          new Error(
            `The ${mode} actor returned unreadable output: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    });

    child.on("error", reject);
  });
}

async function runActor(kindeUserId: string, goal: string): Promise<void> {
  const convex = convexServerClient();
  const { user } = await convex.query(api.gateway.brokerContext, {
    secret: convexServerSecret(),
    kindeUserId,
  });
  if (!user) throw new Error(`No such user: ${kindeUserId}`);

  const run = await runAgent({
    kindeUserId,
    userId: user._id,
    goal,
    correlationId: newCorrelationId(),
  });

  const payload: ActorResult = { storageMode: storageMode(), run };
  process.stdout.write(`\n__ACTOR_RESULT__${JSON.stringify(payload)}`);
}

/* ----------------------------------------------------------- verification -- */

/**
 * Confirm a comment exists on GitHub, without holding a credential.
 *
 * The sandbox repository is public, so this read needs no token. It is a
 * check by an outside observer rather than the app looking at its own work.
 */
async function commentExistsOnGitHub(commentId: number): Promise<{
  exists: boolean;
  author: string | null;
  createdAt: string | null;
}> {
  const target = gitHubTargetEnv();
  const response = await fetch(
    `https://api.github.com/repos/${target.GITHUB_TARGET_OWNER}/${target.GITHUB_TARGET_REPO}/issues/comments/${commentId}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "connected-apps-github-demo-narrative",
      },
    },
  );
  if (!response.ok) return { exists: false, author: null, createdAt: null };
  const body = (await response.json()) as {
    user?: { login?: string };
    created_at?: string;
  };
  return {
    exists: true,
    author: body.user?.login ?? null,
    createdAt: body.created_at ?? null,
  };
}

function commentIdFrom(run: AgentRunResult): number | null {
  for (const call of run.toolCalls) {
    if (call.actionId !== "comment_issue" || call.outcome !== "ok") continue;
    const data = call.data as { commentId?: unknown } | undefined;
    if (typeof data?.commentId === "number") return data.commentId;
  }
  return null;
}

/* ------------------------------------------------------------- the story -- */

async function narrative(kindeUserId: string): Promise<void> {
  const convex = convexServerClient();
  const secret = convexServerSecret();
  const target = gitHubTargetEnv();

  console.log("End-to-end narrative");
  console.log(`repository   ${target.GITHUB_TARGET_OWNER}/${target.GITHUB_TARGET_REPO}`);
  console.log(`user         ${kindeUserId}`);
  console.log(`this process ${storageMode()} (acting steps run in child processes)`);

  const { user, connection } = await convex.query(api.gateway.brokerContext, {
    secret,
    kindeUserId,
  });
  if (!user) fatal(`no such user: ${kindeUserId}`);
  if (connection?.status !== "linked") {
    fatal(
      `the GitHub connection is "${connection?.status ?? "missing"}". Connect it first: npm run probe -- link ${kindeUserId}, authorize, then npm run broker -- connect ${kindeUserId}`,
    );
  }
  const userId = user._id as Id<"users">;

  /* ---------------------------------------------------- 1. clean slate -- */

  step("1. Clean slate");

  const cleared = await convex.mutation(api.gateway.resetUserHistory, {
    secret,
    userId,
  });
  note(
    `cleared ${cleared.runs} run(s), ${cleared.runEvents} event(s), ${cleared.auditLog} audit row(s)`,
  );

  const baselineMetrics = await convex.query(api.metrics.forUser, { userId });
  assert(
    "the counters start at zero",
    baselineMetrics.actionsBrokered === 0 &&
      baselineMetrics.actionsInvoked === 0 &&
      baselineMetrics.actionsRefused === 0 &&
      baselineMetrics.revocations === 0,
    `brokered=${baselineMetrics.actionsBrokered} invoked=${baselineMetrics.actionsInvoked} refused=${baselineMetrics.actionsRefused} revocations=${baselineMetrics.revocations}`,
  );

  const baselineDump = await convex.query(api.gateway.dumpAll, { secret });
  const baselineStore = scanStore(baselineDump as Record<string, unknown[]>);
  assert(
    "the store holds no GitHub credential",
    baselineStore.length === 0,
    baselineStore.length === 0
      ? `${Object.values(baselineDump as Record<string, unknown[]>).reduce((n, rows) => n + rows.length, 0)} row(s) scanned across ${Object.keys(baselineDump).length} tables`
      : baselineStore.map((f) => `${f.what} in ${f.where}`).join("; "),
  );

  // This process is a connected-app deployment, so its environment must be
  // clean too. The stored-key child gets its token from a separate file.
  const baselineEnv = scanEnvironment();
  assert(
    "this connected-app process holds no GitHub credential in its environment",
    baselineEnv.length === 0,
    baselineEnv.length === 0
      ? `${Object.keys(process.env).length} variable(s) scanned`
      : baselineEnv.map((f) => `${f.what} in ${f.where}`).join("; "),
  );

  /* ----------------------------------------- 2. connected-app acts -- */

  step("2. connected-app — the agent acts");

  const acted = await actInMode(
    "connected-app",
    kindeUserId,
    "Read the open issues, then post one short useful comment on the issue you can help with most concretely.",
  );

  assert(
    "the run happened in connected-app mode",
    acted.storageMode === "connected-app",
    `the child reported ${acted.storageMode}`,
  );
  assert(
    "the agent completed the task",
    acted.run.status === "succeeded",
    `status=${acted.run.status} — ${acted.run.finalMessage.slice(0, 120)}`,
  );
  assert(
    "the agent read before it wrote",
    acted.run.toolCalls.some((c) => c.actionId.startsWith("read_")),
    acted.run.toolCalls.map((c) => `${c.actionId}:${c.outcome}`).join(", "),
  );

  const commentId = commentIdFrom(acted.run);
  if (!assert(
    "the agent commented through the broker",
    commentId !== null,
    commentId === null
      ? "no successful comment_issue call was recorded"
      : `comment id ${commentId}`,
  )) {
    fatal("without a comment there is nothing to verify on GitHub");
  }

  const onGitHub = await commentExistsOnGitHub(commentId!);
  assert(
    "the comment is really on GitHub",
    onGitHub.exists,
    onGitHub.exists
      ? `comment ${commentId} by ${onGitHub.author} at ${onGitHub.createdAt}`
      : `GitHub has no comment ${commentId}`,
  );

  const afterActDump = await convex.query(api.gateway.dumpAll, { secret });
  const afterActStore = scanStore(afterActDump as Record<string, unknown[]>);
  assert(
    "the app persisted no GitHub token while acting",
    afterActStore.length === 0,
    afterActStore.length === 0
      ? "every row of every table scanned, nothing found"
      : afterActStore.map((f) => `${f.what} in ${f.where}`).join("; "),
  );

  const actAudit = await convex.query(api.audit.byCorrelationId, {
    correlationId: acted.run.correlationId,
  });
  assert(
    "the action is audited under one correlationId",
    actAudit.length > 0 &&
      actAudit.every((row) => row.correlationId === acted.run.correlationId),
    `${actAudit.length} row(s) under ${acted.run.correlationId}`,
  );
  assert(
    "a token was brokered per action, not once for the run",
    actAudit.filter((r) => r.event === "token.brokered").length ===
      actAudit.filter((r) => r.event === "action.invoked").length,
    `${actAudit.filter((r) => r.event === "token.brokered").length} brokered, ${actAudit.filter((r) => r.event === "action.invoked").length} invoked`,
  );

  /* ------------------------------------------- 3. connected-app revoked -- */

  step("3. connected-app — revoke, then the agent tries again");

  const sessionsBefore = await getUserSessions(kindeUserId);
  const sessionsBeforeJson = JSON.stringify(sessionsBefore.body);

  const revokeCorrelationId = newCorrelationId();
  const revoked = await revokeConnection({
    kindeUserId,
    correlationId: revokeCorrelationId,
  });

  assert(
    "the connection was revoked at Kinde",
    revoked.status === "revoked",
    revoked.status === "revoked"
      ? `HTTP ${revoked.httpStatus} in ${revoked.durationMs}ms`
      : `status=${revoked.status}`,
  );

  const revokeAudit = await convex.query(api.audit.byCorrelationId, {
    correlationId: revokeCorrelationId,
  });
  assert(
    "the revocation is audited with a correlationId",
    revokeAudit.some(
      (row) => row.event === "connection.revoked" && row.outcome === "allowed",
    ),
    `${revokeAudit.length} row(s) under ${revokeCorrelationId}`,
  );

  const refused = await actInMode(
    "connected-app",
    kindeUserId,
    "Comment on the oldest open issue to say the work is done.",
  );

  assert(
    "the agent is refused after revocation",
    refused.run.status === "refused",
    `status=${refused.run.status} — ${refused.run.finalMessage.slice(0, 160)}`,
  );
  assert(
    "the agent was cut off within one action",
    refused.run.toolCalls.length === 1 &&
      refused.run.toolCalls[0].outcome === "refused",
    refused.run.toolCalls.map((c) => `${c.actionId}:${c.outcome}`).join(", ") ||
      "no tool calls",
  );
  assert(
    "no comment landed after revocation",
    commentIdFrom(refused.run) === null,
    "no successful comment_issue call in the refused run",
  );

  const refusedAudit = await convex.query(api.audit.byCorrelationId, {
    correlationId: refused.run.correlationId,
  });
  assert(
    "the refusal is audited with a correlationId",
    refusedAudit.some((row) => row.outcome === "refused"),
    refusedAudit.map((r) => `${r.event}/${r.outcome}`).join(", ") || "no rows",
  );

  // Login survival. A command-line process holds no browser session, so what
  // is checkable here is that revoking the connected app did not disturb the
  // user's Kinde sessions. The live browser check is the stronger evidence.
  const sessionsAfter = await getUserSessions(kindeUserId);
  assert(
    "revoking the connection did not touch the user's Kinde sessions",
    sessionsAfter.status === 200 &&
      JSON.stringify(sessionsAfter.body) === sessionsBeforeJson,
    `HTTP ${sessionsAfter.status}, session list unchanged`,
  );
  note(
    "this process has no browser session. Login survival was observed in the",
  );
  note(
    "browser: after revoking, a full page reload kept the operator signed in.",
  );

  /* ------------------------------------------------ 4. stored-key acts -- */

  step("4. stored-key — the same revocation, and the agent acts anyway");
  note("This is the load-bearing negative. It must hold.");

  const holeRun = await actInMode(
    "stored-key",
    kindeUserId,
    "Read the open issues, then post one short useful comment on any open issue.",
  );

  assert(
    "the run happened in stored-key mode",
    holeRun.storageMode === "stored-key",
    `the child reported ${holeRun.storageMode}`,
  );
  assert(
    "the agent still acts after the connection was revoked",
    holeRun.run.status === "succeeded",
    `status=${holeRun.run.status} — ${holeRun.run.finalMessage.slice(0, 160)}`,
  );

  const holeCommentId = commentIdFrom(holeRun.run);
  if (!assert(
    "a comment was posted after revocation",
    holeCommentId !== null,
    holeCommentId === null
      ? "no successful comment_issue call was recorded"
      : `comment id ${holeCommentId}`,
  )) {
    fatal("the load-bearing negative cannot be verified without a comment");
  }

  const holeOnGitHub = await commentExistsOnGitHub(holeCommentId!);
  assert(
    "that comment is really on GitHub, posted after the revocation",
    holeOnGitHub.exists,
    holeOnGitHub.exists
      ? `comment ${holeCommentId} by ${holeOnGitHub.author} at ${holeOnGitHub.createdAt}`
      : `GitHub has no comment ${holeCommentId}`,
  );

  const holeAudit = await convex.query(api.audit.byCorrelationId, {
    correlationId: holeRun.run.correlationId,
  });
  assert(
    "the stored-key run never consulted Kinde",
    holeAudit.some(
      (row) =>
        row.event === "token.brokered" &&
        (row.detail ?? "").includes("Kinde was not consulted"),
    ),
    holeAudit
      .filter((r) => r.event === "token.brokered")
      .map((r) => r.detail)
      .join(" | ") || "no token.brokered rows",
  );

  /* ------------------------------------------------ 5. reconciliation -- */

  step("5. Audit reconciliation");

  const finalMetrics = await convex.query(api.metrics.forUser, { userId });
  const allRows = await convex.query(api.metrics.auditForUser, {
    userId,
    limit: 200,
  });

  const byMode = finalMetrics.actionsAfterRevocationByMode;
  assert(
    "no connected-app action succeeded after revocation",
    (byMode["connected-app"] ?? 0) === 0,
    `connected-app after revocation = ${byMode["connected-app"] ?? 0}`,
  );
  assert(
    "stored-key actions did succeed after the same revocation",
    (byMode["stored-key"] ?? 0) > 0,
    `stored-key after revocation = ${byMode["stored-key"] ?? 0}`,
  );

  // Tokens the app keeps is a property of the deployment, not of the data.
  assert(
    "a connected-app deployment keeps zero GitHub tokens",
    storageMode() === "connected-app" && scanEnvironment().length === 0,
    `mode=${storageMode()}, credential-shaped values in the environment: ${scanEnvironment().length}`,
  );

  const correlationIds = new Set(allRows.map((row) => row.correlationId));
  assert(
    "every audit row carries a correlationId",
    allRows.every((row) => Boolean(row.correlationId)),
    `${allRows.length} row(s), ${correlationIds.size} distinct correlationId(s)`,
  );
  for (const [label, id] of [
    ["the connected-app run", acted.run.correlationId],
    ["the revocation", revokeCorrelationId],
    ["the refused run", refused.run.correlationId],
    ["the stored-key run", holeRun.run.correlationId],
  ] as const) {
    assert(
      `${label} is present in the trail`,
      correlationIds.has(id),
      id,
    );
  }

  const finalStore = scanStore(
    (await convex.query(api.gateway.dumpAll, { secret })) as Record<
      string,
      unknown[]
    >,
  );
  assert(
    "no GitHub credential reached the store at any point",
    finalStore.length === 0,
    finalStore.length === 0
      ? `${allRows.length} audit row(s) and every other table scanned`
      : finalStore.map((f) => `${f.what} in ${f.where}`).join("; "),
  );
}

/* ------------------------------------------------------------------ main -- */

async function main(): Promise<void> {
  const [first, second, third] = process.argv.slice(2);

  if (first === "actor") {
    if (!second || !third) throw new Error("actor needs a user id and a goal");
    return await runActor(second, third);
  }

  if (!first) {
    throw new Error("Usage: npm run narrative -- <kindeUserId>");
  }

  const startedAt = Date.now();
  await narrative(first);

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n${"═".repeat(60)}`);

  if (failures.length === 0) {
    console.log(`GREEN — every assertion held. ${seconds}s`);
    return;
  }

  console.log(`RED — ${failures.length} assertion(s) failed. ${seconds}s\n`);
  for (const failure of failures) {
    console.log(`  ${failure.step}`);
    console.log(`    ${failure.what}`);
    console.log(`    ${failure.detail}`);
  }
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
