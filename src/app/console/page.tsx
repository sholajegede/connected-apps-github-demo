import { redirect } from "next/navigation";
import { LogoutLink } from "@kinde-oss/kinde-auth-nextjs/components";
import { ConnectionPanel } from "@/components/ConnectionPanel";
import { Metrics } from "@/components/Metrics";
import { Records } from "@/components/Records";
import { TaskRunner } from "@/components/TaskRunner";
import { gitHubTargetEnv, storageMode } from "@/lib/env";
import { CONNECTED_APP } from "@/lib/storage-mode";
import { currentOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The operator console.
 *
 * The storage mode is read here, on the server, and passed down for display
 * only. No component below can set it, and no request can influence it.
 */
export default async function ConsolePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const operator = await currentOperator();
  if (!operator) redirect("/");

  const params = await searchParams;
  const mode = storageMode();
  const connectedApp = mode === CONNECTED_APP;

  // The unsafe mode holds exactly one GitHub token; the safe mode holds none.
  // This is a fact about the deployment, not about the data.
  const tokensStored = connectedApp ? 0 : 1;

  let target = { owner: "—", repo: "—" };
  try {
    const env = gitHubTargetEnv();
    target = { owner: env.GITHUB_TARGET_OWNER, repo: env.GITHUB_TARGET_REPO };
  } catch {
    // Left as dashes; the console still works and the run will say why.
  }

  const connection = operator.connection;
  const status = connection?.status ?? "unlinked";
  const connectError = params.connectError;
  const justConnected = params.connected === "1";

  return (
    <main className="wrap">
      <header
        className="row"
        style={{ marginBottom: "1.1rem", alignItems: "flex-start" }}
      >
        <div className="grow">
          <h1>Operator console</h1>
          <p className="muted small" style={{ margin: "0.2rem 0 0" }}>
            Signed in as {operator.name || operator.email || operator.kindeUserId}
            {" · "}
            acting on{" "}
            <a
              href={`https://github.com/${target.owner}/${target.repo}`}
              target="_blank"
              rel="noreferrer"
            >
              {target.owner}/{target.repo}
            </a>
          </p>
        </div>
        <div className="row">
          <span
            className={
              connectedApp ? "badge badge-ok" : "badge badge-warn"
            }
            title="Set by the deployment environment. The interface cannot change it."
          >
            STORAGE_MODE: {mode}
          </span>
          <LogoutLink className="button">Sign out</LogoutLink>
        </div>
      </header>

      {connectError ? (
        <div className="notice notice-danger">
          Could not connect GitHub: {String(connectError)}
        </div>
      ) : null}
      {justConnected ? (
        <div className="notice notice-ok">
          GitHub connected. Kinde holds the authorization; this app stored no
          token.
        </div>
      ) : null}

      <div className="panel">
        <h2>What this deployment does</h2>
        <p className="small" style={{ margin: 0 }}>
          {connectedApp ? (
            <>
              The app holds <strong>no</strong> GitHub token. For each action
              the broker asks Kinde for one, uses it for that single call, and
              drops it. Revoking the connection stops the next fetch, so the
              agent is cut off within one action.
            </>
          ) : (
            <>
              The app holds its <strong>own long-lived</strong> GitHub token and
              calls GitHub directly with it. Kinde is never consulted, so
              revoking the connection does not stop the agent. This is the hole,
              reproduced deliberately.
            </>
          )}
        </p>
      </div>

      <div className="panel">
        <h2>Live numbers</h2>
        <Metrics
          userId={operator.userId}
          tokensStored={tokensStored}
          connectedApp={connectedApp}
        />
      </div>

      <ConnectionPanel
        status={status}
        githubLogin={connection?.githubLogin ?? null}
        scopes={connection?.grantedScopes ?? []}
        lastBrokeredAt={connection?.lastBrokeredAt ?? null}
        brokerCount={connection?.brokerCount ?? 0}
        connectedApp={connectedApp}
      />

      <TaskRunner connected={status === "linked"} connectedApp={connectedApp} />

      <div className="panel">
        <h2>Records — what actually happened</h2>
        <Records userId={operator.userId} />
      </div>
    </main>
  );
}
