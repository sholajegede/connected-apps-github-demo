import { describe, expect, it } from "vitest";
import {
  ACTION_IDS,
  getAction,
  isActionId,
  listActions,
  parseActionInput,
  readActions,
  writeActions,
} from "@/lib/actions/registry";

describe("action registry", () => {
  it("registers exactly the four demo actions", () => {
    expect([...ACTION_IDS]).toEqual([
      "read_issues",
      "read_issue",
      "comment_issue",
      "open_pr",
    ]);
    expect(listActions()).toHaveLength(4);
  });

  it("classifies the safe actions as reads and the rest as writes", () => {
    expect(readActions().map((a) => a.id)).toEqual([
      "read_issues",
      "read_issue",
    ]);
    expect(writeActions().map((a) => a.id)).toEqual([
      "comment_issue",
      "open_pr",
    ]);
  });

  it("marks only the write actions as acting in the user's account", () => {
    for (const action of listActions()) {
      expect(action.actsAsUser).toBe(action.effect === "write");
    }
  });

  it("gives every action a least-privilege scope set", () => {
    for (const action of listActions()) {
      expect(action.requiredScopes.length).toBeGreaterThan(0);
      // `repo` is full private-repository access. The demo never needs it.
      expect(action.requiredScopes).not.toContain("repo");
      expect(action.requiredScopes).not.toContain("admin:org");
      expect(action.requiredScopes).not.toContain("delete_repo");
    }
  });

  it("asks for public_repo and nothing else", () => {
    // The Kinde connected app grants only public_repo, so the registry must
    // not claim a scope the connection cannot hold.
    for (const action of listActions()) {
      expect([...action.requiredScopes]).toEqual(["public_repo"]);
    }
  });

  it("asks for no identity scope", () => {
    // The acting login is read out of the API response, not granted.
    for (const action of listActions()) {
      for (const scope of action.requiredScopes) {
        expect(scope).not.toMatch(/^(read:)?user/);
      }
    }
  });

  it("refuses an action that is not registered", () => {
    expect(() => getAction("delete_repo")).toThrow(/not in the registry/i);
    expect(() => getAction("read_issues ")).toThrow(/not in the registry/i);
    expect(isActionId("open_pr")).toBe(true);
    expect(isActionId("open_PR")).toBe(false);
    expect(isActionId(null)).toBe(false);
  });

  it("applies defaults when parsing input", () => {
    expect(parseActionInput("read_issues", {})).toEqual({
      state: "open",
      limit: 10,
    });
    expect(
      parseActionInput("open_pr", { title: "Fix", head: "patch-1" }),
    ).toEqual({ title: "Fix", body: "", head: "patch-1", base: "main" });
  });

  it("rejects input that does not match the action's schema", () => {
    expect(() => parseActionInput("read_issue", { issueNumber: 0 })).toThrow(
      /invalid arguments/i,
    );
    expect(() =>
      parseActionInput("read_issue", { issueNumber: "12" }),
    ).toThrow(/invalid arguments/i);
    expect(() => parseActionInput("comment_issue", { issueNumber: 1 })).toThrow(
      /body/i,
    );
    expect(() =>
      parseActionInput("read_issues", { state: "everything" }),
    ).toThrow(/invalid arguments/i);
  });

  it("caps how much a single read can pull", () => {
    expect(() => parseActionInput("read_issues", { limit: 500 })).toThrow(
      /invalid arguments/i,
    );
  });
});
