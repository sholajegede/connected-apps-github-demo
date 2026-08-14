import { describe, expect, it } from "vitest";
import { compareScopes, describeScopes } from "@/lib/broker/scopes";
import { listActions } from "@/lib/actions/registry";

describe("scope comparison", () => {
  it("accepts a connection that grants exactly what is needed", () => {
    const result = compareScopes(["public_repo"], ["public_repo"]);
    expect(result.sufficient).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.excess).toEqual([]);
    expect(describeScopes(result)).toMatch(/least privilege holds/i);
  });

  it("flags a shortfall", () => {
    const result = compareScopes(["public_repo"], ["read:org"]);
    expect(result.sufficient).toBe(false);
    expect(result.missing).toEqual(["public_repo"]);
    expect(describeScopes(result)).toMatch(/missing public_repo/i);
  });

  it("treats repo as satisfying public_repo, but still excess", () => {
    // This is the stored-key shape observed live: gist, read:org, repo,
    // workflow. It works, and it is far more than the action needs.
    const result = compareScopes(
      ["public_repo"],
      ["gist", "read:org", "repo", "workflow"],
    );
    expect(result.sufficient).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.excess.sort()).toEqual(["gist", "read:org", "repo", "workflow"]);
    expect(describeScopes(result)).toMatch(/over-privileged/i);
  });

  it("says nothing when GitHub reported no scopes", () => {
    expect(compareScopes(["public_repo"], null).granted).toBeNull();
    expect(compareScopes(["public_repo"], []).granted).toBeNull();
    expect(describeScopes(compareScopes(["public_repo"], null))).toBeNull();
  });

  it("holds for every registered action against the real connection grant", () => {
    // The Kinde connected app grants public_repo and nothing else.
    for (const action of listActions()) {
      const result = compareScopes(action.requiredScopes, ["public_repo"]);
      expect(result.sufficient).toBe(true);
      expect(result.excess).toEqual([]);
    }
  });
});
