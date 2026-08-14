import { redirect } from "next/navigation";
import { LoginLink } from "@kinde-oss/kinde-auth-nextjs/components";
import { storageMode } from "@/lib/env";
import { currentOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const operator = await currentOperator().catch(() => null);
  if (operator) redirect("/console");

  const mode = storageMode();

  return (
    <main className="wrap" style={{ maxWidth: "40rem", paddingTop: "5rem" }}>
      <h1>Connected Apps GitHub Demo</h1>
      <p className="muted" style={{ marginTop: "0.4rem" }}>
        An agent acts in your GitHub account through one token broker. Sign in,
        connect GitHub, give the agent a task, then cut it off and watch what
        happens.
      </p>

      <div className="panel" style={{ marginTop: "1.5rem" }}>
        <div className="row">
          <LoginLink className="button button-primary">Sign in</LoginLink>
          <span className="muted small">
            Your session with this app is separate from the GitHub connection.
          </span>
        </div>
      </div>

      <div className="panel">
        <h2>This deployment</h2>
        <div className="row">
          <span
            className={
              mode === "connected-app" ? "badge badge-ok" : "badge badge-warn"
            }
          >
            {mode}
          </span>
          <span className="muted small">
            {mode === "connected-app"
              ? "The app stores no GitHub token. It asks Kinde for one per action and drops it."
              : "The app holds its own long-lived GitHub token. Revoking the connection will not stop it."}
          </span>
        </div>
        <p className="muted small" style={{ margin: "0.75rem 0 0" }}>
          The mode is set by the deployment environment. Nothing in this
          interface can change it.
        </p>
      </div>
    </main>
  );
}
