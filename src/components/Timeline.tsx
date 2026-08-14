"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

/**
 * The live run timeline.
 *
 * Subscribes to Convex, so events appear as the agent produces them rather
 * than when a request finishes. Each row shows what was requested, what the
 * broker did about it, and the correlationId that ties it to the audit trail.
 */

const TONE: Record<string, string> = {
  "agent.tool_requested": "request",
  "broker.executed": "ok",
  "broker.refused": "refused",
  "broker.failed": "refused",
  "run.halted": "refused",
  "run.error": "refused",
};

const LABEL: Record<string, string> = {
  "run.started": "task received",
  "agent.said": "agent",
  "agent.tool_requested": "tool requested",
  "broker.executed": "broker executed",
  "broker.refused": "broker refused",
  "broker.failed": "broker failed",
  "run.halted": "halted",
  "run.finished": "finished",
  "run.error": "error",
};

export function Timeline({ runId }: { runId: Id<"runs"> | null }) {
  const events = useQuery(api.runs.events, runId ? { runId } : "skip");
  const run = useQuery(api.runs.get, runId ? { runId } : "skip");

  if (!runId) {
    return (
      <p className="muted small">
        Give the agent a task. Each step appears here as it happens.
      </p>
    );
  }

  if (events === undefined) {
    return <p className="muted small">Waiting for the first step…</p>;
  }

  return (
    <>
      <div className="row small" style={{ marginBottom: "0.6rem" }}>
        <span className="muted">status</span>
        <span
          className={
            run?.status === "succeeded"
              ? "badge badge-ok"
              : run?.status === "refused"
                ? "badge badge-danger"
                : run?.status === "failed"
                  ? "badge badge-danger"
                  : "badge badge-neutral"
          }
        >
          {run?.status ?? "starting"}
        </span>
        {run?.model ? (
          <span className="muted mono">model {run.model}</span>
        ) : null}
      </div>

      <ul className="timeline">
        {events.map((event) => {
          const tone = TONE[event.type] ?? "";
          const cid =
            event.data && typeof event.data === "object" && "correlationId" in event.data
              ? String((event.data as { correlationId: unknown }).correlationId)
              : event.correlationId;
          return (
            <li key={event._id} className={`event ${tone}`}>
              <span className="dot" aria-hidden="true" />
              <div>
                <div className="head">
                  <span className="type">{LABEL[event.type] ?? event.type}</span>
                  <span className="cid">{cid}</span>
                </div>
                <div className="msg">{event.message}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
