"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

/**
 * The records view: what actually happened, from the audit log.
 *
 * Every row was written by the broker or the kill switch at the moment it
 * acted. Nothing here is reconstructed after the fact.
 */
export function Records({ userId }: { userId: Id<"users"> }) {
  const rows = useQuery(api.metrics.auditForUser, { userId, limit: 40 });

  if (rows === undefined) {
    return <p className="muted small">Loading…</p>;
  }
  if (rows.length === 0) {
    return (
      <p className="muted small">
        Nothing yet. Connect GitHub and run a task.
      </p>
    );
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>time</th>
            <th>mode</th>
            <th>event</th>
            <th>outcome</th>
            <th>action</th>
            <th>correlationId</th>
            <th>detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row._id}>
              <td className="mono">
                {new Date(row.at).toLocaleTimeString()}
              </td>
              <td>
                <span
                  className={
                    row.storageMode === "connected-app"
                      ? "badge badge-ok"
                      : "badge badge-warn"
                  }
                >
                  {row.storageMode}
                </span>
              </td>
              <td className="mono">{row.event}</td>
              <td>
                <span
                  className={
                    row.outcome === "allowed"
                      ? "badge badge-ok"
                      : row.outcome === "refused"
                        ? "badge badge-danger"
                        : "badge badge-warn"
                  }
                >
                  {row.outcome}
                </span>
              </td>
              <td className="mono">{row.actionId ?? "—"}</td>
              <td className="mono">{row.correlationId.slice(0, 18)}…</td>
              <td className="wrap-cell">{row.detail ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
