# Connected Apps GitHub Demo

An OpenAI agent reads issues and writes comments in a user's GitHub account.
The app stores no GitHub token. Kinde holds the GitHub grant and gives the app
one short-life token for each action. When the user revokes the connection,
the agent stops.

## The problem

An agent that acts in your GitHub account needs a credential. Most apps solve
this the direct way: they ask for a token and keep it. That token now sits in
the app's database or environment. It usually carries more access than the work
needs. Nobody can take it back except the app itself. If you want the agent to
stop, you must trust the app to stop.

This app never receives a token to keep. Kinde holds the GitHub authorization.
The broker asks Kinde for a token, uses it for one call, and discards it. You
revoke the connection at Kinde, and the next action fails because the app has
nothing left to use.

![A diagram of one action reaching GitHub. The operator writes a task. The
agent proposes an action and holds no token. The broker asks Kinde Connected
Apps for a token, receives one short-life token, and acts on GitHub as the
user. A green box states that the app keeps no GitHub token. Below, a red panel
shows what happens after the operator revokes the connection: Kinde gives no
more tokens and the broker refuses the next action, while a token that GitHub
already issued stays valid until it expires.](docs/broker.svg)

## How the broker works

Every GitHub action passes through one function. No other code in the app calls
GitHub.

1. The agent asks for an action. The agent holds no token.
2. The broker makes sure the action is in the registry. It rejects any other
   name.
3. The broker gets a credential.
   - In `connected-app` mode it asks Kinde.
   - In `stored-key` mode it uses the token the app keeps.
4. The broker performs the action and writes a record with a correlation id.
5. The token goes out of scope. Nothing writes it to storage or to a log.

If Kinde gives no token, the broker refuses the action. A refusal is a recorded
result, not an error. The agent stops and reports it.

The broker gives each action handler a call function, not the token. A handler
cannot read, copy or log a credential, because it never holds one.

## The two modes

`STORAGE_MODE` selects the mode. The deployment sets it. The browser cannot set
it, and the agent cannot set it. Any value except `stored-key` becomes
`connected-app`, which is the safe mode.

| Mode | What the app keeps | After you revoke |
| --- | --- | --- |
| `connected-app` | Nothing | The next action fails |
| `stored-key` | Its own long-life token | The agent keeps acting |

Run `stored-key` to see the problem. The app holds a GitHub token, so it never
asks Kinde. Revocation reaches nothing, and the agent continues to comment on
real issues.

## What the agent can do

The registry lists four actions and nothing else. The agent cannot name its way
to an action that does not exist.

| Action | Effect | Acts as the user |
| --- | --- | --- |
| `read_issues` | Reads | No |
| `read_issue` | Reads | No |
| `comment_issue` | Writes | Yes |
| `open_pr` | Writes | Yes |

Each action asks for one GitHub scope: `public_repo`. The demo uses no identity
scope. It reads the GitHub login from the response of a call it already makes.

## Limitations

These are measured results. Read them as they are written.

### Revocation does not cancel a token that GitHub already issued

Revocation stops Kinde at once. Kinde gives no new token and refreshes no old
one. But a token that Kinde already supplied stays valid at GitHub until it
expires, which is about 8 hours.

A brokered token stayed valid 37.6 seconds after the revocation, across six
calls. Nothing in the revoke path touches GitHub.

To cancel the outstanding token, revoke the authorization on GitHub. GitHub
owns that control. Kinde does not have it.

### The cutoff is quick because the app keeps nothing

In `connected-app` mode the next action fails at once, because the app must ask
Kinde and Kinde refuses. The speed comes from the app holding nothing between
actions. It does not come from revocation reaching into GitHub.

This is why the broker must not cache a token. A cache gives access that
continues after the revocation.

### Kinde gives the same token again, not a new one

Two token requests inside the same 8-hour period return the identical token. A
fingerprint of each token shows this.

The correct claim is that the app keeps nothing between actions. The claim is
not that each action gets a new token.

### Read queries use an id, not access control

All writes need a server secret. The browser does not have it, so the browser
cannot change a record or change the mode. But the read queries trust the id
they receive. This is enough for one operator. It is not access control.

## Setup

You need your own keys. Use no key that belongs to somebody else, and put no
key in the repository.

### 1. Kinde

Create three things in your Kinde business.

**A back-end web app**, so the user can sign in. Set these URLs:

- Allowed callback URL: `http://localhost:3000/api/auth/kinde_callback`
- Allowed logout redirect URL: `http://localhost:3000`

**A machine-to-machine app**, so the server can call the Management API. Give
it these scopes:

- `read:connected_apps`
- `create:connected_apps`
- `read:users`
- `read:user_sessions`
- `delete:user_sessions`

**GitHub as a connected app**, under Settings then Connected apps. Set a key
code reference, and select the `public_repo` scope only. Copy the callback URL
that Kinde shows you. Set the connected app callback to
`http://localhost:3000/api/connect/github/callback`.

### 2. GitHub OAuth app

Create an OAuth app at `github.com/settings/developers`. Put Kinde's callback
URL in it. Copy the client id and the client secret into the Kinde connected
app.

Turn on **Expire user access tokens**. GitHub then issues 8-hour tokens and a
refresh token. Without this setting the token never expires, and the demo makes
a weaker claim.

### 3. Convex

```
npx convex dev
```

Set the shared server secret on the deployment. Use the same value in
`.env.local`.

```
npx convex env set CONVEX_SERVER_SECRET <value>
```

### 4. Environment

Copy `.env.example` to `.env.local` and complete it.

| Variable | Purpose |
| --- | --- |
| `APP_BASE_URL` | Where the app runs |
| `STORAGE_MODE` | `connected-app` or `stored-key` |
| `CONVEX_DEPLOYMENT` | Written by the Convex CLI |
| `NEXT_PUBLIC_CONVEX_URL` | Written by the Convex CLI |
| `CONVEX_SERVER_SECRET` | Shared between the server and Convex |
| `KINDE_ISSUER_URL` | Your Kinde domain |
| `KINDE_CLIENT_ID` | The back-end web app |
| `KINDE_CLIENT_SECRET` | The back-end web app |
| `KINDE_SITE_URL` | Where the app runs |
| `KINDE_POST_LOGIN_REDIRECT_URL` | Where sign-in returns the user |
| `KINDE_POST_LOGOUT_REDIRECT_URL` | Where sign-out returns the user |
| `KINDE_M2M_CLIENT_ID` | The machine-to-machine app |
| `KINDE_M2M_CLIENT_SECRET` | The machine-to-machine app |
| `KINDE_MANAGEMENT_AUDIENCE` | Your Kinde domain with `/api` |
| `KINDE_GITHUB_CONNECTED_APP_KEY` | The key code reference |
| `OPENAI_API_KEY` | Your OpenAI key |
| `OPENAI_MODEL` | A model that supports tool calls |
| `GITHUB_TARGET_OWNER` | The repository owner |
| `GITHUB_TARGET_REPO` | The repository name |

Point the demo at a repository you are happy to write to. The agent posts real
comments.

`stored-key` mode needs one more variable, and it lives in a separate file.
Create `.env.stored-key`:

```
GITHUB_STORED_TOKEN=<a classic personal access token with public_repo>
```

The app loads that file only when `STORAGE_MODE` is `stored-key`. Keep it
separate so a `connected-app` run holds no GitHub token in its environment.

## Run it

```
npm install
npx convex dev
npm run dev
```

Open `http://localhost:3000`.

1. Sign in.
2. Connect GitHub. Kinde asks you to authorize the OAuth app.
3. Write a task, then start it. The timeline shows each step as it happens.
4. Read the comment on the real issue.
5. Revoke the connection. The next task you start fails, and you stay signed
   in.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the app |
| `npm test` | Runs the tests |
| `npm run build` | Builds for production |
| `npm run probe -- whoami` | Checks the Kinde credentials |
| `npm run probe -- link <user>` | Gets the GitHub authorization URL |
| `npm run broker -- connect <user>` | Records the connection |
| `npm run broker -- act <user> <action> '<json>'` | Performs one action |
| `npm run broker -- revoke <user>` | Revokes the connection |
| `npm run agent -- <user> "<task>"` | Gives the agent a task |
| `npm run prove -- <user> agent` | Looks for a kept credential |
| `npm run narrative -- <user>` | Runs the full story |

## The end-to-end narrative

One script walks the whole story and checks the real result at each step.

```
npm run narrative -- <kindeUserId>
```

The script needs a connected GitHub account, so authorize first.

It does this:

1. Clears the user's history, then makes sure the counters start at zero and
   the store holds no credential.
2. Runs the agent in `connected-app` mode, then confirms the comment on GitHub
   and confirms the app kept no token.
3. Revokes the connection, runs the agent again, and confirms the broker
   refuses the next action.
4. Runs the agent in `stored-key` mode after the same revocation, then confirms
   a comment still appears on GitHub.
5. Reconciles the audit trail across both modes.

Each acting step runs in a child process with its own `STORAGE_MODE`, because
the mode is a deployment decision. The script exits non-zero if any check
fails, and it names the check.

Step 4 is the load-bearing check. It proves the problem is real.

## Tests

```
npm test
```

The tests protect the properties this app claims:

- One module calls GitHub. Only the broker uses it.
- The agent does not import the GitHub client and holds no credential.
- The agent code has no storage-mode branch. Only the broker differs.
- No table has a field that can hold a token.
- The broker keeps no token between actions and writes no token to a log.
- The kill switch uses `connected_apps/revoke`. It does not use the
  user-sessions endpoint, which reports success but stops nothing.

## How it fails

| Condition | Result |
| --- | --- |
| Kinde does not answer in 8 seconds | Refused and recorded |
| Kinde is unreachable | Refused and recorded |
| Kinde returns `INVALID_SESSION` | Refused and recorded |
| The connection is revoked | Refused and recorded |
| GitHub does not answer in 12 seconds | Failed and recorded |
| The app cannot write the record | Refused, and the row goes to a local queue |

No failure falls through to a direct GitHub call. No failure becomes a quiet
success.

## Stack

Next.js, React, Convex, Kinde, the OpenAI API, TypeScript, Vitest.

## Licence

MIT.
