"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { revoke, type RevokeState } from "@/app/actions";

/**
 * Connection status and the revoke control.
 *
 * Revoking cuts the app's ability to act in GitHub. It does not sign the
 * operator out — the header stays exactly as it was, which is the property
 * this panel exists to demonstrate.
 */

function RevokeButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="danger" disabled={pending}>
      {pending ? "Revoking…" : "Revoke connection"}
    </button>
  );
}

export function ConnectionPanel({
  status,
  githubLogin,
  scopes,
  lastBrokeredAt,
  brokerCount,
  connectedApp,
}: {
  status: "linked" | "revoked" | "unlinked";
  githubLogin: string | null;
  scopes: string[];
  lastBrokeredAt: number | null;
  brokerCount: number;
  connectedApp: boolean;
}) {
  const [state, formAction] = useActionState<RevokeState, FormData>(revoke, {
    message: null,
    error: null,
    correlationId: null,
  });

  const badge =
    status === "linked"
      ? "badge badge-ok"
      : status === "revoked"
        ? "badge badge-danger"
        : "badge badge-neutral";

  return (
    <div className="panel">
      <h2>GitHub connection</h2>

      {state.message ? (
        <div className="notice notice-ok">{state.message}</div>
      ) : null}
      {state.error ? (
        <div className="notice notice-danger">{state.error}</div>
      ) : null}

      <div className="row">
        <span className={badge}>{status}</span>
        {githubLogin ? (
          <span className="small">
            as <strong>{githubLogin}</strong>
          </span>
        ) : null}
        {scopes.length > 0 ? (
          <span className="muted small mono">{scopes.join(", ")}</span>
        ) : null}
        <span className="grow" />
        {status === "linked" ? (
          <form action={formAction}>
            <RevokeButton />
          </form>
        ) : (
          <a className="button button-primary" href="/api/connect/github/start">
            {status === "revoked" ? "Reconnect GitHub" : "Connect GitHub"}
          </a>
        )}
      </div>

      <p className="muted small" style={{ margin: "0.75rem 0 0" }}>
        {status === "linked" ? (
          <>
            Kinde holds the authorization. This app stores no GitHub token — it
            asks for one per action and drops it.{" "}
            {brokerCount > 0 ? (
              <>
                {brokerCount} token{brokerCount === 1 ? "" : "s"} brokered so
                far
                {lastBrokeredAt
                  ? `, last at ${new Date(lastBrokeredAt).toLocaleTimeString()}`
                  : ""}
                .
              </>
            ) : null}
          </>
        ) : status === "revoked" ? (
          connectedApp ? (
            <>
              Revoked. Kinde will broker no further token, so the next action is
              refused. You are still signed in to this app.
            </>
          ) : (
            <>
              Revoked at Kinde — but this deployment holds its own GitHub token,
              so the agent can still act. That is the hole.
            </>
          )
        ) : (
          <>Connect GitHub to let the agent act in your account.</>
        )}
      </p>

      {status === "revoked" ? (
        <p className="muted small" style={{ margin: "0.5rem 0 0" }}>
          Revocation stops Kinde brokering or refreshing tokens. It does not
          reach into GitHub to kill a token already issued.
        </p>
      ) : null}
    </div>
  );
}
