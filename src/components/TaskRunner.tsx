"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import type { Id } from "@convex/_generated/dataModel";
import { startRun, type StartRunState } from "@/app/actions";
import { Timeline } from "./Timeline";

/**
 * The operator writes the task. Nothing here is a preset, and nothing is
 * hardcoded — whatever they type is what the agent is asked to do.
 */

const EXAMPLES = [
  "Read the open issues and comment on the one that looks most actionable.",
  "Look at issue 2 and suggest what an example config file should contain.",
  "Summarise the open issues, then leave a comment on the oldest one.",
];

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="primary" disabled={pending || disabled}>
      {pending ? "Starting…" : "Run the task"}
    </button>
  );
}

export function TaskRunner({
  connected,
  connectedApp,
}: {
  connected: boolean;
  connectedApp: boolean;
}) {
  const [state, formAction] = useActionState<StartRunState, FormData>(startRun, {
    runId: null,
    correlationId: null,
    error: null,
  });
  const [goal, setGoal] = useState("");
  const [runId, setRunId] = useState<Id<"runs"> | null>(null);

  useEffect(() => {
    if (state.runId) setRunId(state.runId as Id<"runs">);
  }, [state.runId]);

  // In connected-app mode an unconnected GitHub means the run will be refused.
  // Say so before they press the button rather than after.
  const willBeRefused = connectedApp && !connected;

  return (
    <>
      <div className="panel">
        <h2>Give the agent a task</h2>

        {willBeRefused ? (
          <div className="notice notice-warn">
            GitHub is not connected, so the broker has no token to fetch. A run
            will be refused. Connect GitHub above first.
          </div>
        ) : null}

        {state.error ? (
          <div className="notice notice-danger">{state.error}</div>
        ) : null}

        <form action={formAction}>
          <textarea
            name="goal"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="Tell the agent what to do in the repository…"
            maxLength={1000}
            aria-label="Task for the agent"
          />
          <div className="row" style={{ marginTop: "0.6rem" }}>
            <SubmitButton disabled={goal.trim().length === 0} />
            <span className="muted small">
              Every tool call goes through the broker.
            </span>
          </div>
        </form>

        <div style={{ marginTop: "0.85rem" }}>
          <div className="muted small" style={{ marginBottom: "0.35rem" }}>
            Or start from one of these:
          </div>
          <div className="row">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                className="small"
                onClick={() => setGoal(example)}
                style={{ fontWeight: 400, textAlign: "left" }}
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Live timeline</h2>
        <Timeline runId={runId} />
      </div>
    </>
  );
}
