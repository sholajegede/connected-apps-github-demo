// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { api, internal } from "@convex/_generated/api";
import { listActions } from "@/lib/actions/registry";
import { newCorrelationId, isCorrelationId } from "@/lib/correlation";
import { harness } from "./harness";

const catalogEntries = () =>
  listActions().map((action) => ({
    actionId: action.id,
    title: action.title,
    description: action.description,
    effect: action.effect,
    actsAsUser: action.actsAsUser,
    requiredScopes: [...action.requiredScopes],
  }));

describe("users", () => {
  it("creates once and updates on the next sign-in", async () => {
    const t = harness();

    const first = await t.mutation(internal.users.upsert, {
      kindeUserId: "kp_user_1",
      email: "person@example.com",
    });
    const second = await t.mutation(internal.users.upsert, {
      kindeUserId: "kp_user_1",
      name: "A Person",
    });

    expect(second).toBe(first);

    const user = await t.query(api.users.getByKindeUserId, {
      kindeUserId: "kp_user_1",
    });
    expect(user?.email).toBe("person@example.com");
    expect(user?.name).toBe("A Person");
  });
});

describe("connections", () => {
  it("moves through linked, brokered and revoked without holding a token", async () => {
    const t = harness();
    const userId = await t.mutation(internal.users.upsert, {
      kindeUserId: "kp_user_2",
    });

    const connectionId = await t.mutation(internal.connections.markLinked, {
      userId,
      kindeConnectionId: "conn_github",
      githubLogin: "octo-person",
      grantedScopes: ["public_repo", "read:user"],
    });

    let connection = await t.query(api.connections.getForUser, { userId });
    expect(connection?.status).toBe("linked");
    expect(connection?.brokerCount).toBe(0);
    expect(Object.keys(connection ?? {})).not.toContain("accessToken");

    await t.mutation(internal.connections.noteBrokered, {
      connectionId,
      githubLogin: "octo-person",
    });
    await t.mutation(internal.connections.noteBrokered, { connectionId });

    connection = await t.query(api.connections.getForUser, { userId });
    expect(connection?.brokerCount).toBe(2);
    expect(connection?.lastBrokeredAt).toBeTypeOf("number");

    await t.mutation(internal.connections.markRevoked, { userId });
    connection = await t.query(api.connections.getForUser, { userId });
    expect(connection?.status).toBe("revoked");
    expect(connection?.revokedAt).toBeTypeOf("number");
  });

  it("relinking the same user reuses the row and clears the revocation", async () => {
    const t = harness();
    const userId = await t.mutation(internal.users.upsert, {
      kindeUserId: "kp_user_3",
    });

    const first = await t.mutation(internal.connections.markLinked, {
      userId,
      kindeConnectionId: "conn_github",
    });
    await t.mutation(internal.connections.markRevoked, { userId });
    const second = await t.mutation(internal.connections.markLinked, {
      userId,
      kindeConnectionId: "conn_github",
    });

    expect(second).toBe(first);
    const connection = await t.query(api.connections.getForUser, { userId });
    expect(connection?.status).toBe("linked");
    expect(connection?.revokedAt).toBeUndefined();
  });
});

describe("action catalogue", () => {
  it("persists the code registry and is idempotent", async () => {
    const t = harness();

    await t.mutation(internal.catalog.sync, { entries: catalogEntries() });
    await t.mutation(internal.catalog.sync, { entries: catalogEntries() });

    const rows = await t.query(api.catalog.list, {});
    expect(rows).toHaveLength(listActions().length);
    expect(rows.map((r) => r.actionId).sort()).toEqual(
      listActions()
        .map((a) => a.id)
        .sort(),
    );
    for (const row of rows) expect(row.enabled).toBe(true);

    const commentIssue = await t.query(api.catalog.getByActionId, {
      actionId: "comment_issue",
    });
    expect(commentIssue?.effect).toBe("write");
    expect(commentIssue?.actsAsUser).toBe(true);
  });

  it("disables an action dropped from the registry instead of deleting it", async () => {
    const t = harness();

    await t.mutation(internal.catalog.sync, { entries: catalogEntries() });
    await t.mutation(internal.catalog.sync, {
      entries: catalogEntries().filter((e) => e.actionId !== "open_pr"),
    });

    const openPr = await t.query(api.catalog.getByActionId, {
      actionId: "open_pr",
    });
    expect(openPr).not.toBeNull();
    expect(openPr?.enabled).toBe(false);
  });
});

describe("runs and the audit trail", () => {
  it("keeps the timeline ordered and ties every row to one correlationId", async () => {
    const t = harness();
    const userId = await t.mutation(internal.users.upsert, {
      kindeUserId: "kp_user_4",
    });

    const correlationId = newCorrelationId();
    expect(isCorrelationId(correlationId)).toBe(true);

    const runId = await t.mutation(internal.runs.start, {
      userId,
      correlationId,
      goal: "Comment on the oldest open issue.",
      storageMode: "connected-app",
      model: "test-model-id",
    });

    for (const [type, message] of [
      ["agent.plan", "Read the open issues."],
      ["action.invoked", "read_issues"],
      ["action.invoked", "comment_issue"],
    ] as const) {
      await t.mutation(internal.runs.appendEvent, { runId, type, message });
    }

    const events = await t.query(api.runs.events, { runId });
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(events.every((e) => e.correlationId === correlationId)).toBe(true);

    await t.mutation(internal.audit.record, {
      correlationId,
      userId,
      runId,
      event: "token.brokered",
      outcome: "allowed",
      storageMode: "connected-app",
      detail: "Fresh token fetched for one action, then discarded.",
    });
    await t.mutation(internal.audit.record, {
      correlationId,
      userId,
      runId,
      event: "action.invoked",
      outcome: "allowed",
      actionId: "comment_issue",
      storageMode: "connected-app",
    });
    await t.mutation(internal.audit.record, {
      correlationId,
      userId,
      event: "connection.revoked",
      outcome: "allowed",
      storageMode: "connected-app",
    });

    await t.mutation(internal.runs.finish, { runId, status: "succeeded" });

    const run = await t.query(api.runs.get, { runId });
    expect(run?.status).toBe("succeeded");
    expect(run?.finishedAt).toBeTypeOf("number");

    const rows = await t.query(api.audit.byCorrelationId, { correlationId });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.event).sort()).toEqual([
      "action.invoked",
      "connection.revoked",
      "token.brokered",
    ]);
    for (const row of rows) {
      expect(row.correlationId).toBe(correlationId);
      expect(row.storageMode).toBe("connected-app");
      expect(JSON.stringify(row)).not.toMatch(/gh[pousr]_/);
    }
  });

  it("records a refused action with its reason", async () => {
    const t = harness();
    const userId = await t.mutation(internal.users.upsert, {
      kindeUserId: "kp_user_5",
    });
    const correlationId = newCorrelationId();

    const runId = await t.mutation(internal.runs.start, {
      userId,
      correlationId,
      goal: "Comment after revocation.",
      storageMode: "connected-app",
    });
    await t.mutation(internal.audit.record, {
      correlationId,
      userId,
      runId,
      event: "token.refused",
      outcome: "refused",
      actionId: "comment_issue",
      storageMode: "connected-app",
      detail: "Kinde returned no token for the connection.",
    });
    await t.mutation(internal.runs.finish, {
      runId,
      status: "refused",
      error: "No token from Kinde.",
    });

    const [row] = await t.query(api.audit.byCorrelationId, { correlationId });
    expect(row.outcome).toBe("refused");
    expect(row.actionId).toBe("comment_issue");

    const run = await t.query(api.runs.get, { runId });
    expect(run?.status).toBe("refused");
  });

  it("returns the most recent audit rows first", async () => {
    const t = harness();
    for (let i = 0; i < 3; i++) {
      await t.mutation(internal.audit.record, {
        correlationId: newCorrelationId(),
        event: "action.invoked",
        outcome: "allowed",
        storageMode: "stored-key",
        detail: `row ${i}`,
      });
    }
    const rows = await t.query(api.audit.recent, { limit: 10 });
    expect(rows).toHaveLength(3);
    expect(rows[0].detail).toBe("row 2");
  });
});
