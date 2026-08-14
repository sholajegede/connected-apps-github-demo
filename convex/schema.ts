import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Data model.
 *
 * A hard rule holds across every table here: no table has a field that holds a
 * GitHub access token or refresh token, in any mode. The `connections` table
 * records that a connection exists and what state it is in. The credential
 * itself lives with Kinde. `tests/convex/schema.test.ts` asserts this by
 * walking the schema, so a token field cannot be added by accident later.
 */

/** How a connection stands right now. */
export const connectionStatus = v.union(
  v.literal("linked"),
  v.literal("revoked"),
  v.literal("unlinked"),
);

/** Whether an action only reads, or writes into the user's account. */
export const actionEffect = v.union(v.literal("read"), v.literal("write"));

/** The deployment's storage mode, recorded on every run and audit row. */
export const storageMode = v.union(
  v.literal("stored-key"),
  v.literal("connected-app"),
);

export const runStatus = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("refused"),
);

/** What an audited attempt actually did. */
export const auditOutcome = v.union(
  v.literal("allowed"),
  v.literal("refused"),
  v.literal("failed"),
);

/** The kind of event an audit row records. */
export const auditEvent = v.union(
  v.literal("connection.linked"),
  v.literal("connection.revoked"),
  v.literal("token.brokered"),
  v.literal("token.refused"),
  v.literal("action.invoked"),
  v.literal("action.refused"),
);

export default defineSchema({
  /** A signed-in user of the demo, keyed by their Kinde subject. */
  users: defineTable({
    kindeUserId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    createdAt: v.number(),
    lastSeenAt: v.number(),
  }).index("by_kindeUserId", ["kindeUserId"]),

  /**
   * A user's GitHub connection state. State only — never a credential.
   * `kindeConnectionId` is the Kinde connected app id, which is configuration,
   * not a secret.
   */
  connections: defineTable({
    userId: v.id("users"),
    provider: v.literal("github"),
    kindeConnectionId: v.string(),
    /**
     * The Kinde connected app session handle. This is the id the broker gives
     * to `connected_apps/token` to ask Kinde for a token.
     *
     * It is deliberately NOT a GitHub credential. It carries no access to
     * GitHub on its own — it is useless without the Kinde M2M credentials,
     * and Kinde stops honouring it the instant the connection is revoked
     * (measured: the next fetch fails at +0ms). Kinde's model requires the
     * app to keep this handle; keeping it is what lets the app hold no token.
     */
    kindeSessionId: v.optional(v.string()),
    status: connectionStatus,
    /** The GitHub login observed the last time a token was brokered. */
    githubLogin: v.optional(v.string()),
    /** Scopes Kinde reported for the connection, for display and audit. */
    grantedScopes: v.optional(v.array(v.string())),
    linkedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    lastBrokeredAt: v.optional(v.number()),
    /** How many times a token has been brokered for this connection. */
    brokerCount: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_provider", ["userId", "provider"]),

  /**
   * The catalogue of actions the agent may attempt. The code registry in
   * `src/lib/actions/registry.ts` is the source of truth; this table is the
   * persisted projection of it, so the console and the audit trail can join
   * against it.
   */
  actions: defineTable({
    actionId: v.string(),
    title: v.string(),
    description: v.string(),
    effect: actionEffect,
    /** True when the action writes into the user's own GitHub account. */
    actsAsUser: v.boolean(),
    requiredScopes: v.array(v.string()),
    enabled: v.boolean(),
    updatedAt: v.number(),
  }).index("by_actionId", ["actionId"]),

  /** One agent task, from prompt to outcome. */
  runs: defineTable({
    userId: v.id("users"),
    correlationId: v.string(),
    goal: v.string(),
    status: runStatus,
    storageMode: storageMode,
    /** The OpenAI model id used, read from configuration at run time. */
    model: v.optional(v.string()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_correlationId", ["correlationId"]),

  /** The ordered timeline within a run. */
  runEvents: defineTable({
    runId: v.id("runs"),
    correlationId: v.string(),
    seq: v.number(),
    type: v.string(),
    message: v.string(),
    /** Structured detail. Never a credential. */
    data: v.optional(v.any()),
    at: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_run_seq", ["runId", "seq"])
    .index("by_correlationId", ["correlationId"]),

  /**
   * Every brokered action and every revocation lands here, with the
   * correlationId that ties it back to the run that caused it.
   */
  auditLog: defineTable({
    correlationId: v.string(),
    userId: v.optional(v.id("users")),
    runId: v.optional(v.id("runs")),
    event: auditEvent,
    outcome: auditOutcome,
    actionId: v.optional(v.string()),
    storageMode: storageMode,
    /** Human-readable reason. Never a credential. */
    detail: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_correlationId", ["correlationId"])
    .index("by_user", ["userId"])
    .index("by_event", ["event"])
    .index("by_at", ["at"]),
});
