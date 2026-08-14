"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

/**
 * The metric block, live from the audit log.
 *
 * `tokensStored` is not derived from data — it is a property of the
 * deployment, decided on the server and passed in. The console displays it and
 * never determines it.
 */
export function Metrics({
  userId,
  tokensStored,
  connectedApp,
}: {
  userId: Id<"users">;
  tokensStored: number;
  connectedApp: boolean;
}) {
  const metrics = useQuery(api.metrics.forUser, { userId });
  const loading = metrics === undefined;

  const brokered = metrics?.actionsBrokered ?? 0;
  const invoked = metrics?.actionsInvoked ?? 0;
  const refused = metrics?.actionsRefused ?? 0;
  const after = metrics?.actionsAfterRevocation ?? 0;
  const revoked = metrics?.revocations ?? 0;

  // After a revocation, connected-app must be zero. stored-key will not be,
  // and that is the number worth staring at.
  const afterTone = loading || revoked === 0 ? "" : after === 0 ? "good" : "bad";

  return (
    <div className="metrics">
      <div className="metric">
        <div className="value">{loading ? "—" : brokered}</div>
        <div className="label">tokens supplied, one for each action</div>
      </div>

      <div className={`metric ${tokensStored === 0 ? "good" : "bad"}`}>
        <div className="value">{tokensStored}</div>
        <div className="label">GitHub tokens that the app keeps</div>
      </div>

      <div className="metric">
        <div className="value">{loading ? "—" : invoked}</div>
        <div className="label">actions done on GitHub</div>
      </div>

      <div className="metric">
        <div className="value">{loading ? "—" : refused}</div>
        <div className="label">actions refused</div>
      </div>

      <div className={`metric ${afterTone}`}>
        <div className="value">{loading || revoked === 0 ? "—" : after}</div>
        <div className="label">
          {revoked === 0
            ? "actions after revocation — none yet"
            : connectedApp
              ? "actions after revocation"
              : "actions after revocation — the agent continues"}
        </div>
      </div>
    </div>
  );
}
