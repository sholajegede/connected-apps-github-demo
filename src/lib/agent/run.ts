import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { brokerAction, type BrokerOutcome } from "@/lib/broker";
import { convexServerClient, convexServerSecret } from "@/lib/convex-server";
import { newCorrelationId } from "@/lib/correlation";
import { openAiEnv, storageMode } from "@/lib/env";
import { agentTools } from "./tool-schema";

/**
 * The agent.
 *
 * What this module does NOT have is the point of it:
 *
 *   - It never imports the GitHub client. `tests/unit/one-caller.test.ts`
 *     enforces that.
 *   - It never sees a token. It proposes an action; the broker decides whether
 *     there is a credential for it and performs the call.
 *   - It has no storage-mode branch anywhere. The same agent code runs in
 *     both modes; only the broker behind it differs.
 *
 * The agent carries the signed-in user's Kinde subject so the broker knows
 * whose connection to use. That identifier is not a credential — on its own it
 * grants nothing.
 */

const MAX_TURNS = 8;

export interface AgentRunRequest {
  kindeUserId: string;
  userId: Id<"users">;
  goal: string;
  correlationId?: string;
}

export interface AgentRunResult {
  runId: Id<"runs">;
  correlationId: string;
  status: "succeeded" | "failed" | "refused";
  finalMessage: string;
  toolCalls: {
    actionId: string;
    outcome: BrokerOutcome["status"];
    detail: string;
  }[];
}

const SYSTEM_PROMPT = `You act on a GitHub repository on behalf of the signed-in user.

You have no credentials. Every tool call is executed by a broker that holds the
user's authorization; you only propose actions.

Rules you must follow:
- Read before you write. Look at the issues before commenting on one.
- Comment on exactly one issue, the one most relevant to the task.
- If a tool call is refused because there is no credential, stop. Do not retry
  it and do not try a different tool to work around it. Report the refusal.
- Keep comments short, specific and useful. Write as the user, not as a bot.
- When the task is done, reply with a one-paragraph summary and no tool call.`;

export async function runAgent(
  request: AgentRunRequest,
): Promise<AgentRunResult> {
  const env = openAiEnv();
  // Model id is configuration. It appears nowhere in this file as a literal.
  const model = env.OPENAI_MODEL;
  const mode = storageMode();
  const correlationId = request.correlationId ?? newCorrelationId();

  const convex = convexServerClient();
  const secret = convexServerSecret();
  const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  const runId = await convex.mutation(api.gateway.startRun, {
    secret,
    userId: request.userId,
    correlationId,
    goal: request.goal,
    storageMode: mode,
    model,
  });

  const emit = async (type: string, message: string, data?: unknown) => {
    await convex.mutation(api.gateway.appendRunEvent, {
      secret,
      runId,
      type,
      message,
      data: data === undefined ? undefined : { ...(data as object), correlationId },
    });
  };

  await emit("run.started", request.goal, { model, storageMode: mode });

  const tools = agentTools() as unknown as ChatCompletionTool[];
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: request.goal },
  ];

  const toolCalls: AgentRunResult["toolCalls"] = [];
  let finalMessage = "";
  let status: AgentRunResult["status"] = "succeeded";

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const completion = await openai.chat.completions.create({
        model,
        messages,
        tools,
      });

      const choice = completion.choices[0];
      const message = choice.message;
      messages.push(message);

      if (message.content) {
        await emit("agent.said", message.content);
      }

      const requested = message.tool_calls ?? [];
      if (requested.length === 0) {
        finalMessage = message.content ?? "";
        break;
      }

      let halt = false;

      for (const toolCall of requested) {
        if (toolCall.type !== "function") continue;
        const actionId = toolCall.function.name;

        let input: unknown = {};
        try {
          input = toolCall.function.arguments
            ? JSON.parse(toolCall.function.arguments)
            : {};
        } catch {
          input = {};
        }

        await emit("agent.tool_requested", `Requested ${actionId}.`, {
          actionId,
          input,
        });

        // The one and only path to GitHub.
        const outcome = await brokerAction({
          actionId,
          input,
          kindeUserId: request.kindeUserId,
          correlationId,
          runId,
        });

        let toolReply: string;

        if (outcome.status === "ok") {
          toolReply = JSON.stringify({
            ok: true,
            summary: outcome.summary,
            data: outcome.data,
          });
          await emit("broker.executed", outcome.summary, {
            actionId,
            actingLogin: outcome.actingLogin,
            storageMode: outcome.storageMode,
          });
          toolCalls.push({
            actionId,
            outcome: "ok",
            detail: outcome.summary,
          });
        } else {
          toolReply = JSON.stringify({
            ok: false,
            refused: outcome.status === "refused",
            reason: outcome.reason,
          });
          await emit(
            outcome.status === "refused" ? "broker.refused" : "broker.failed",
            outcome.reason,
            {
              actionId,
              storageMode: outcome.storageMode,
              refusal: outcome.status === "refused" ? outcome.refusal : undefined,
            },
          );
          toolCalls.push({
            actionId,
            outcome: outcome.status,
            detail: outcome.reason,
          });

          // Fail closed. A credential refusal will not resolve itself, so the
          // run stops here rather than looping or reaching for another route.
          if (outcome.status === "refused" && outcome.refusal === "credential") {
            halt = true;
            status = "refused";
            finalMessage = `Stopped: ${outcome.reason}`;
          }
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: toolReply,
        });
      }

      if (halt) {
        await emit(
          "run.halted",
          "The broker refused to supply a credential. The agent stopped instead of retrying.",
        );
        break;
      }
    }

    if (status === "succeeded" && !finalMessage) {
      finalMessage = "The run ended without a final message.";
    }
  } catch (error) {
    status = "failed";
    finalMessage = error instanceof Error ? error.message : String(error);
    await emit("run.error", finalMessage);
  }

  await emit("run.finished", finalMessage || status);
  await convex.mutation(api.gateway.finishRun, {
    secret,
    runId,
    status,
    error: status === "succeeded" ? undefined : finalMessage,
  });

  return { runId, correlationId, status, finalMessage, toolCalls };
}
