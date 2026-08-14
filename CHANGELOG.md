# Changelog

## 0.1.0

First release.

### Added

- A token broker. Every GitHub action passes through one function. In
  `connected-app` mode the broker asks Kinde for a token, uses it once, then
  discards it. The app keeps no GitHub token.
- Two modes. `connected-app` keeps nothing. `stored-key` keeps a long-life
  token and shows the problem that the first mode solves. The deployment sets
  the mode. The browser and the agent cannot set it.
- An OpenAI agent that proposes actions and holds no credential. The agent
  code is the same in both modes.
- An action registry with four entries: `read_issues`, `read_issue`,
  `comment_issue` and `open_pr`. Each asks for the `public_repo` scope only.
- An operator console. The user signs in, connects GitHub, writes a task, and
  watches each step in a live timeline. A revoke control cuts the connection.
- A kill switch that calls `connected_apps/revoke`. It does not call the
  user-sessions endpoint, which reports success but stops nothing.
- An audit trail. Every brokered action, refusal and revocation writes a row
  with a correlation id. If the app cannot write the row, it refuses the
  action and queues the row locally.
- `npm run prove` looks for a kept credential in the store, the logs and the
  environment after a real agent run.
- `npm run narrative` walks the whole story against the real services and
  exits non-zero if any check fails.

### Measured

- A brokered token is an opaque `gho_` token with a life of about 8 hours.
- Kinde holds the refresh token. The app never receives one.
- After `connected_apps/revoke`, the next token request fails at once.
- A token that GitHub already issued stays valid after the revocation. It was
  still valid 37.6 seconds later, across six calls.
- `DELETE /users/{id}/sessions` returns success and keeps giving out tokens.
  It is not a kill switch.
