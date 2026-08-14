import type { GitHubCall } from "@/lib/github/client";
import { actingUserFrom, type ActingUser } from "@/lib/github/acting-user";
import type { ActionId, ActionInput } from "./registry";

/**
 * What each registered action actually does.
 *
 * A handler receives an already-authenticated `call` function. It never
 * receives the token, so it cannot read, copy, log or persist one. It also
 * cannot reach GitHub any other way — `call` is the only door.
 */

export interface HandlerContext {
  owner: string;
  repo: string;
}

export interface HandlerResult {
  /** Short line for the run timeline. Never contains a credential. */
  summary: string;
  /** Structured result handed back to the caller and, later, the agent. */
  data: unknown;
  /** Who GitHub says acted, when the response revealed it. */
  actingUser: ActingUser | null;
  /** Scopes GitHub reported on the call. */
  scopes: string[];
}

type Handler<K extends ActionId> = (
  call: GitHubCall,
  input: ActionInput<K>,
  ctx: HandlerContext,
) => Promise<HandlerResult>;

function fail(action: string, status: number, body: unknown): never {
  const message =
    body && typeof body === "object" && "message" in body
      ? String((body as { message: unknown }).message)
      : `HTTP ${status}`;
  throw new Error(`GitHub refused ${action}: ${message}`);
}

interface IssueSummary {
  number: number;
  title: string;
  state: string;
  user?: { login?: string };
  body?: string | null;
  html_url?: string;
}

const readIssues: Handler<"read_issues"> = async (call, input, ctx) => {
  const result = await call<IssueSummary[]>(
    `/repos/${ctx.owner}/${ctx.repo}/issues`,
    { query: { state: input.state, per_page: input.limit } },
  );
  if (!result.ok) fail("read_issues", result.status, result.body);

  const issues = (result.body ?? []).map((issue) => ({
    number: issue.number,
    title: issue.title,
    state: issue.state,
    author: issue.user?.login ?? null,
  }));

  return {
    summary: `Read ${issues.length} ${input.state} issue(s) in ${ctx.owner}/${ctx.repo}.`,
    data: issues,
    actingUser: null,
    scopes: result.scopes,
  };
};

const readIssue: Handler<"read_issue"> = async (call, input, ctx) => {
  const result = await call<IssueSummary>(
    `/repos/${ctx.owner}/${ctx.repo}/issues/${input.issueNumber}`,
  );
  if (!result.ok) fail("read_issue", result.status, result.body);

  const issue = result.body;
  return {
    summary: `Read issue #${issue.number}: ${issue.title}`,
    data: {
      number: issue.number,
      title: issue.title,
      state: issue.state,
      body: issue.body ?? "",
      author: issue.user?.login ?? null,
    },
    actingUser: null,
    scopes: result.scopes,
  };
};

const commentIssue: Handler<"comment_issue"> = async (call, input, ctx) => {
  const result = await call<{ id: number; html_url: string; user?: unknown }>(
    `/repos/${ctx.owner}/${ctx.repo}/issues/${input.issueNumber}/comments`,
    { method: "POST", body: { body: input.body } },
  );
  if (!result.ok) fail("comment_issue", result.status, result.body);

  // The response carries the account that acted. That is where the audit
  // trail's identity comes from — no identity scope is involved.
  const actingUser = actingUserFrom(result.body);

  return {
    summary: `Commented on issue #${input.issueNumber} as ${actingUser?.login ?? "the connected account"}.`,
    data: { commentId: result.body.id, url: result.body.html_url },
    actingUser,
    scopes: result.scopes,
  };
};

const openPr: Handler<"open_pr"> = async (call, input, ctx) => {
  const result = await call<{
    number: number;
    html_url: string;
    user?: unknown;
  }>(`/repos/${ctx.owner}/${ctx.repo}/pulls`, {
    method: "POST",
    body: {
      title: input.title,
      body: input.body,
      head: input.head,
      base: input.base,
    },
  });
  if (!result.ok) fail("open_pr", result.status, result.body);

  const actingUser = actingUserFrom(result.body);

  return {
    summary: `Opened pull request #${result.body.number} as ${actingUser?.login ?? "the connected account"}.`,
    data: { number: result.body.number, url: result.body.html_url },
    actingUser,
    scopes: result.scopes,
  };
};

const HANDLERS = {
  read_issues: readIssues,
  read_issue: readIssue,
  comment_issue: commentIssue,
  open_pr: openPr,
} satisfies { [K in ActionId]: Handler<K> };

/**
 * A handler seen from the broker, where the action id is only known at run
 * time. The `satisfies` clause above is what checks each handler against its
 * own action's input type; this signature just makes the map callable at the
 * boundary, where the input has already been validated by the registry.
 */
export type AnyHandler = (
  call: GitHubCall,
  input: never,
  ctx: HandlerContext,
) => Promise<HandlerResult>;

/** Every registered action has a handler; the type above guarantees it. */
export function getHandler(id: ActionId): AnyHandler {
  return HANDLERS[id] as AnyHandler;
}
