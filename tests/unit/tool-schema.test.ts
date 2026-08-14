import { describe, expect, it } from "vitest";
import { agentTools, toJsonSchema } from "@/lib/agent/tool-schema";
import { ACTION_IDS, getAction } from "@/lib/actions/registry";

describe("agent tools", () => {
  it("exposes exactly the registered actions and nothing more", () => {
    const names = agentTools().map((tool) => tool.function.name);
    expect(names).toEqual([...ACTION_IDS]);
  });

  it("tells the model which tools write into the user's account", () => {
    for (const tool of agentTools()) {
      const action = getAction(tool.function.name);
      const description = tool.function.description;
      if (action.effect === "write") {
        expect(description).toMatch(/writes into the signed-in user's own/i);
      } else {
        expect(description).toMatch(/only reads/i);
      }
    }
  });

  it("marks defaulted fields optional and the rest required", () => {
    const byName = Object.fromEntries(
      agentTools().map((tool) => [tool.function.name, tool.function.parameters]),
    );

    // read_issues has defaults for both fields, so nothing is required.
    expect(byName.read_issues.required).toEqual([]);
    // read_issue has one required field and no defaults.
    expect(byName.read_issue.required).toEqual(["issueNumber"]);
    // comment_issue requires both; neither has a default.
    expect(byName.comment_issue.required?.sort()).toEqual([
      "body",
      "issueNumber",
    ]);
    // open_pr defaults body and base, so only title and head are required.
    expect(byName.open_pr.required?.sort()).toEqual(["head", "title"]);
  });

  it("converts integers, enums and descriptions", () => {
    const readIssues = agentTools().find(
      (tool) => tool.function.name === "read_issues",
    )!.function.parameters;

    expect(readIssues.type).toBe("object");
    expect(readIssues.additionalProperties).toBe(false);
    expect(readIssues.properties?.state.enum).toEqual([
      "open",
      "closed",
      "all",
    ]);
    expect(readIssues.properties?.limit.type).toBe("integer");
    expect(readIssues.properties?.limit.description).toMatch(/at most 50/i);
  });

  it("derives a schema for every registered action", () => {
    for (const id of ACTION_IDS) {
      const schema = toJsonSchema(getAction(id).input);
      expect(schema.type).toBe("object");
      expect(Object.keys(schema.properties ?? {}).length).toBeGreaterThan(0);
    }
  });
});
