/**
 * The only place in this codebase that calls GitHub.
 *
 * Nothing else imports this module except the broker. `tests/unit/one-caller.test.ts`
 * enforces that by walking the source tree, so a second GitHub call cannot be
 * added quietly somewhere else.
 *
 * The token is closed over by `createGitHubClient` and never leaves it. Action
 * handlers are handed the returned `GitHubCall` function, not the credential,
 * so a handler has no way to read, copy, log or persist it.
 */

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "connected-apps-github-demo";

/**
 * A hang must not become an action that never finishes. The deadline turns an
 * unreachable GitHub into a recorded failure.
 */
const GITHUB_TIMEOUT_MS = 12_000;

export interface GitHubResult<T = unknown> {
  ok: boolean;
  status: number;
  body: T;
  /** GitHub's view of the token's scopes, for the audit trail. */
  scopes: string[];
}

export interface GitHubCallOptions {
  method?: "GET" | "POST" | "PATCH";
  /** JSON request body. */
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

export type GitHubCall = <T = unknown>(
  path: string,
  options?: GitHubCallOptions,
) => Promise<GitHubResult<T>>;

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

/**
 * Bind a token to a caller.
 *
 * The token exists only inside this closure. It is never returned, never
 * attached to the result, and never written to a log line.
 */
export function createGitHubClient(token: string): GitHubCall {
  return async function call<T>(
    path: string,
    options: GitHubCallOptions = {},
  ): Promise<GitHubResult<T>> {
    const url = new URL(path, GITHUB_API);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? "GET",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": USER_AGENT,
          ...(options.body === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: "no-store",
        signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
      });
    } catch (error) {
      // Unreachable or too slow. The broker records this as a failed action.
      // It never becomes a silent success.
      const detail =
        error instanceof DOMException && error.name === "TimeoutError"
          ? `GitHub did not answer within ${GITHUB_TIMEOUT_MS}ms.`
          : `GitHub is unreachable: ${error instanceof Error ? error.message : String(error)}`;
      throw new GitHubError(detail, 0);
    }

    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    const rawScopes = response.headers.get("x-oauth-scopes") ?? "";
    return {
      ok: response.ok,
      status: response.status,
      body: body as T,
      scopes: rawScopes
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean),
    };
  };
}
