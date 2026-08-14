# Connected Apps GitHub Demo

An agent does work in a user's GitHub account. The application keeps no GitHub
token. A token broker gets a token from Kinde for each action and then discards
it. When the user revokes the connection, the agent stops.

The application has two modes. The modes show the problem and the solution.

| Mode | What the app keeps | Result of revocation |
| --- | --- | --- |
| `connected-app` | Nothing | The next action stops immediately |
| `stored-key` | Its own long-life token | The agent continues to act |

The deployment sets the mode with the `STORAGE_MODE` variable. The browser
cannot set it. The agent cannot set it. Any value other than `stored-key`
becomes `connected-app`, which is the safe mode.

## How the broker works

All GitHub actions go through one function. No other code speaks to GitHub.

1. The agent asks for an action. The agent has no token.
2. The broker makes sure that the action is in the registry.
3. The broker gets a credential.
   - In `connected-app` mode, it asks Kinde. It uses the token one time.
   - In `stored-key` mode, it uses the token that the app keeps.
4. The broker does the action and writes a record with a correlation id.
5. The token goes out of scope. Nothing writes it to storage or to a log.

If Kinde gives no token, the broker refuses the action. A refusal is a
recorded result. It is not an error.

## Limitations

These are measured facts. Do not read them as smaller than they are.

### Revocation does not kill a token that GitHub already issued

Revocation stops Kinde immediately. Kinde brokers no new token and refreshes no
old one. But a token that Kinde already gave out stays valid at GitHub until it
expires, which is about 8 hours.

This was measured. A brokered token stayed valid 37.6 seconds after the
revocation, across six calls. Nothing in the revoke path touches GitHub.

To kill the outstanding token, revoke the authorization on GitHub. That lever
belongs to GitHub. Kinde does not have it.

### The cutoff is fast because the app keeps nothing

In `connected-app` mode the next action stops immediately, because the app must
ask Kinde for a token and Kinde refuses. The speed comes from the app holding
nothing between actions. It does not come from revocation reaching into GitHub.

This is why the broker must not cache a token. A cache would give access that
continues after the revocation.

### Kinde gives the same token again, not a new one

Two token requests in the same 8-hour period return the identical token. This
was measured with a fingerprint of each token.

The correct claim is that the app keeps nothing between actions. The claim is
not that each action gets a new token.

### Read queries use an unguessable id, not access control

All writes need a server secret. The browser does not have it, so the browser
cannot change a record or change the mode. But the read queries trust the id
that they receive. This is sufficient for one operator. It is not access
control.

## Least privilege

The Kinde connected app grants one GitHub scope: `public_repo`. The registry
asks for `public_repo` and nothing more. A test makes sure that no action asks
for `repo`, `admin:org` or `delete_repo`.

The demo does not use an identity scope. It reads the GitHub login from the
response of a call that it already makes.

## Failure behaviour

| Condition | Result |
| --- | --- |
| Kinde does not answer in 8 seconds | Refused and recorded |
| Kinde is unreachable | Refused and recorded |
| Kinde returns `INVALID_SESSION` | Refused and recorded |
| The connection is revoked | Refused and recorded |
| GitHub does not answer in 12 seconds | Failed and recorded |
| The record cannot be written | Refused. The row goes to a local queue file |

No failure falls through to a direct GitHub call. No failure becomes a silent
success.

## Setup

Copy `.env.example` to `.env.local` and complete it.

In Kinde you need three things:

1. A back-end web application, for the user to sign in.
2. A machine-to-machine application, with these scopes: `read:connected_apps`,
   `create:connected_apps`, `read:users`, `read:user_sessions`,
   `delete:user_sessions`.
3. GitHub as a connected app, with the `public_repo` scope only.

Set the server secret on the Convex deployment:

```
npx convex env set CONVEX_SERVER_SECRET <value>
```

Then start the application:

```
npm install
npx convex dev
npm run dev
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the application |
| `npm test` | Run the tests |
| `npm run probe -- whoami` | Check the Kinde credentials |
| `npm run broker -- act <user> <action> '<json>'` | Do one action |
| `npm run broker -- revoke <user>` | Revoke the connection |
| `npm run agent -- <user> "<task>"` | Give the agent a task |
| `npm run prove -- <user> agent` | Look for a kept credential |

## Tests

The tests make sure of the properties that the demo claims:

- One module speaks to GitHub. Only the broker uses it.
- The agent does not import the GitHub client and holds no credential.
- The agent code has no storage-mode branch. Only the broker differs.
- No table has a field that can hold a token.
- The broker keeps no token between actions and writes no token to a log.
- The kill switch uses `connected_apps/revoke`. It does not use the
  user-sessions endpoint, which reports success but stops nothing.
