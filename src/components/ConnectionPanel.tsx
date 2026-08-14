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
            Kinde keeps the authorization. This app keeps no GitHub token. It
            asks for a token for each action, then discards it.{" "}
            {brokerCount > 0 ? (
              <>
                Kinde supplied {brokerCount} token
                {brokerCount === 1 ? "" : "s"} up to now
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
              Revoked. Kinde supplies no more tokens, so the next action
              stops. You stay signed in to this app.
            </>
          ) : (
            <>
              Revoked at Kinde. But this deployment keeps its own GitHub
              token, so the agent continues to act. This is the problem.
            </>
          )
        ) : (
          <>Connect GitHub. Then the agent can act in your account.</>
        )}
      </p>

      {status === "revoked" ? (
        <p className="muted small" style={{ margin: "0.5rem 0 0" }}>
          Revocation stops Kinde immediately. It does not cancel a token that
          GitHub already issued. That token stays valid until it expires.
        </p>
      ) : null}
    </div>
  );
}
