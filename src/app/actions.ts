"use server";

import { revalidatePath } from "next/cache";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { runAgent } from "@/lib/agent/run";
import { revokeConnection } from "@/lib/broker/revoke";
import { convexServerClient, convexServerSecret } from "@/lib/convex-server";
import { newCorrelationId } from "@/lib/correlation";
import { openAiEnv, storageMode } from "@/lib/env";
import { requireOperator } from "@/lib/session";

/**
 * The operator's controls.
 *
 * These run on the server. The storage mode is read here from the environment
 * and is never accepted from the browser — no argument below carries it.
 */

export interface StartRunState {
  runId: string | null;
  correlationId: string | null;
  error: string | null;
}

/**
 * Start an agent run and hand the browser a runId immediately.
 *
 * The run row is created up front so the console can subscribe to its timeline
 * while the agent is still working. The agent itself is not awaited — the
 * browser watches the events arrive rather than waiting on a response.
 */
export async function startRun(
  _previous: StartRunState,
  formData: FormData,
): Promise<StartRunState> {
  const goal = String(formData.get("goal") ?? "").trim();
  if (!goal) {
    return { runId: null, correlationId: null, error: "Write a task first." };
  }
  if (goal.length > 1000) {
    return {
      runId: null,
      correlationId: null,
      error: "That task is too long. Keep it under 1000 characters.",
    };
  }

  let operator;
  try {
    operator = await requireOperator();
  } catch {
    return { runId: null, correlationId: null, error: "Sign in first." };
  }

  const convex = convexServerClient();
  const secret = convexServerSecret();
  const correlationId = newCorrelationId();

  let model: string;
  try {
    model = openAiEnv().OPENAI_MODEL;
  } catch {
    return {
      runId: null,
      correlationId: null,
      error: "The agent is not configured. OPENAI_API_KEY and OPENAI_MODEL are missing.",
    };
  }

  const runId = await convex.mutation(api.gateway.startRun, {
    secret,
    userId: operator.userId,
    correlationId,
    goal,
    storageMode: storageMode(),
    model,
  });

  // Deliberately not awaited. The timeline is the progress indicator.
  void runAgent({
    kindeUserId: operator.kindeUserId,
    userId: operator.userId,
    goal,
    correlationId,
    runId,
  }).catch(async (error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    await convex.mutation(api.gateway.appendRunEvent, {
      secret,
      runId,
      type: "run.error",
      message: reason,
      data: { correlationId },
    });
    await convex.mutation(api.gateway.finishRun, {
      secret,
      runId,
      status: "failed",
      error: reason,
    });
  });

  return { runId, correlationId, error: null };
}

export interface RevokeState {
  message: string | null;
  error: string | null;
  correlationId: string | null;
}

/**
 * Revoke the GitHub connection.
 *
 * This ends the app's ability to act in GitHub. It does not touch the
 * operator's session with this app — that is the point, and the console proves
 * it by staying signed in.
 */
export async function revoke(
  _previous: RevokeState,
  _formData: FormData,
): Promise<RevokeState> {
  let operator;
  try {
    operator = await requireOperator();
  } catch {
    return { message: null, error: "Sign in first.", correlationId: null };
  }

  const correlationId = newCorrelationId();
  const result = await revokeConnection({
    kindeUserId: operator.kindeUserId,
    correlationId,
  });

  revalidatePath("/console");

  if (result.status === "revoked") {
    return {
      correlationId,
      error: null,
      message: result.cutsOffAgent
        ? `Connection revoked in ${result.durationMs}ms. Kinde will broker no further token, so the next action is refused. You are still signed in.`
        : `Connection revoked in ${result.durationMs}ms — but this deployment holds its own GitHub token, so the agent keeps acting.`,
    };
  }

  return {
    correlationId,
    message: null,
    error:
      result.status === "nothing-to-revoke"
        ? result.reason
        : `${result.reason}`,
  };
}

/** Re-read connection state after an external change. */
export async function refreshConsole(): Promise<void> {
  revalidatePath("/console");
}

export type { Id };
