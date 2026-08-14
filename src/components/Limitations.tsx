/**
 * The limitations, stated straight.
 *
 * These are measured facts, not caveats to be softened. Every claim here was
 * observed against the live services, and the demo is weaker if a reader
 * believes something stronger than what was measured.
 */
export function Limitations({ connectedApp }: { connectedApp: boolean }) {
  return (
    <div className="panel">
      <h2>What this demo does not do</h2>

      <dl className="limits">
        <dt>Revocation does not kill a token that GitHub already issued.</dt>
        <dd>
          Revocation stops Kinde immediately. Kinde brokers no new token and
          refreshes no old one. But a token that Kinde already gave out stays
          valid at GitHub until it expires, which is about 8 hours. This was
          measured: a token stayed valid 37.6 seconds after revocation, and
          nothing in the revoke path touches GitHub. To kill the outstanding
          token, revoke the authorization on GitHub. That lever belongs to
          GitHub, not to Kinde.
        </dd>

        <dt>The cutoff is fast because the app keeps no token.</dt>
        <dd>
          {connectedApp
            ? "This app asks Kinde for a token for each action, then discards it. When you revoke, the app has nothing left to use, so the next action stops. The speed comes from holding nothing. It does not come from revocation reaching into GitHub."
            : "This deployment keeps its own GitHub token. Revocation cannot reach it, so the agent continues to act. This is the failure that connected-app mode prevents."}
        </dd>

        <dt>Kinde gives the same token again, not a new one.</dt>
        <dd>
          Two token requests in the same 8-hour period return the identical
          token. This was measured. The correct claim is that the app keeps
          nothing between actions. The claim is not that each action gets a new
          token.
        </dd>

        <dt>The browser reads records with an unguessable id, not a check.</dt>
        <dd>
          The timeline, the records and the counts come directly from the
          database. All writes need a server secret that the browser does not
          have, so the browser cannot change a record. But the read queries
          trust the id that they receive. This is sufficient for one operator.
          It is not access control.
        </dd>
      </dl>
    </div>
  );
}
