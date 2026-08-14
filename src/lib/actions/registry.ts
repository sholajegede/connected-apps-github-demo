import { z } from "zod";

/**
 * The action registry.
 *
 * This is the complete list of things the agent may attempt against GitHub.
 * Nothing outside this list is callable. Every entry is executed by the one
 * token broker; no action carries a credential of its own and no action talks
 * to GitHub directly.
 *
 * `effect: "read"` actions only look. `effect: "write"` actions with
 * `actsAsUser: true` create something in the signed-in user's own GitHub
 * account, under their name.
 */

export const ACTION_IDS = [
  "read_issues",
  "read_issue",
  "comment_issue",
  "open_pr",
] as const;

export type ActionId = (typeof ACTION_IDS)[number];

export type ActionEffect = "read" | "write";

export interface ActionDefinition<
  S extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>,
> {
  id: ActionId;
  title: string;
  description: string;
  effect: ActionEffect;
  /** True when the result appears in the user's GitHub account as their act. */
  actsAsUser: boolean;
  /** Least-privilege OAuth scopes this action needs. */
  requiredScopes: readonly string[];
  input: S;
}

/**
 * Least privilege for this demo: the target repository is public, so
 * `public_repo` alone is enough to read issues, comment and open a pull
 * request. It is the only scope the connection grants.
 *
 * Nothing here asks for an identity scope. The acting GitHub login is read
 * out of the response to a call the action already makes — see
 * `src/lib/github/acting-user.ts` — so the audit trail records who acted
 * without the connection holding any extra permission.
 */
const REQUIRED_SCOPES = ["public_repo"] as const;

const issueNumber = z
  .number()
  .int()
  .positive()
  .describe("The issue number in the target repository.");

const readIssues = {
  id: "read_issues",
  title: "List issues",
  description:
    "List open issues in the target repository. Reads only; changes nothing.",
  effect: "read",
  actsAsUser: false,
  requiredScopes: REQUIRED_SCOPES,
  input: z.object({
    state: z
      .enum(["open", "closed", "all"])
      .default("open")
      .describe("Which issues to list."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe("How many issues to return, at most 50."),
  }),
} as const satisfies ActionDefinition;

const readIssue = {
  id: "read_issue",
  title: "Read one issue",
  description:
    "Read the title, body and state of one issue. Reads only; changes nothing.",
  effect: "read",
  actsAsUser: false,
  requiredScopes: REQUIRED_SCOPES,
  input: z.object({ issueNumber }),
} as const satisfies ActionDefinition;

const commentIssue = {
  id: "comment_issue",
  title: "Comment on an issue",
  description:
    "Post a comment on an issue. The comment appears in the user's own GitHub account, under their name.",
  effect: "write",
  actsAsUser: true,
  requiredScopes: REQUIRED_SCOPES,
  input: z.object({
    issueNumber,
    body: z
      .string()
      .min(1)
      .max(4000)
      .describe("The comment text, in GitHub markdown."),
  }),
} as const satisfies ActionDefinition;

const openPr = {
  id: "open_pr",
  title: "Open a pull request",
  description:
    "Open a pull request from an existing branch. The pull request appears in the user's own GitHub account, under their name.",
  effect: "write",
  actsAsUser: true,
  requiredScopes: REQUIRED_SCOPES,
  input: z.object({
    title: z.string().min(1).max(256).describe("The pull request title."),
    body: z
      .string()
      .max(8000)
      .default("")
      .describe("The pull request description, in GitHub markdown."),
    head: z.string().min(1).describe("The branch that holds the change."),
    base: z
      .string()
      .min(1)
      .default("main")
      .describe("The branch the change merges into."),
  }),
} as const satisfies ActionDefinition;

const REGISTRY = {
  read_issues: readIssues,
  read_issue: readIssue,
  comment_issue: commentIssue,
  open_pr: openPr,
} as const satisfies Record<ActionId, ActionDefinition>;

export type Registry = typeof REGISTRY;

/** Every registered action, in a stable order. */
export function listActions(): readonly ActionDefinition[] {
  return ACTION_IDS.map((id) => REGISTRY[id]);
}

/** True when the string names a registered action. */
export function isActionId(value: unknown): value is ActionId {
  return (
    typeof value === "string" && (ACTION_IDS as readonly string[]).includes(value)
  );
}

/**
 * Look up an action. Throws on anything unregistered, so an agent cannot name
 * its way to a capability that does not exist.
 */
export function getAction(id: string): ActionDefinition {
  if (!isActionId(id)) {
    throw new Error(`Unknown action "${id}". Not in the registry.`);
  }
  return REGISTRY[id];
}

export type ActionInput<K extends ActionId> = z.infer<Registry[K]["input"]>;

/**
 * Validate and normalise an action's arguments. Defaults are applied here, so
 * a caller never has to trust the shape it was handed.
 */
export function parseActionInput<K extends ActionId>(
  id: K,
  raw: unknown,
): ActionInput<K> {
  const action = getAction(id);
  const result = action.input.safeParse(raw ?? {});
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid arguments for "${id}". ${problems}`);
  }
  return result.data as ActionInput<K>;
}

/** Actions that write into the user's account. */
export function writeActions(): readonly ActionDefinition[] {
  return listActions().filter((action) => action.effect === "write");
}

/** Actions that only read. */
export function readActions(): readonly ActionDefinition[] {
  return listActions().filter((action) => action.effect === "read");
}
