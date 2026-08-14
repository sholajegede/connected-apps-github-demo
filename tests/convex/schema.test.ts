// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import schema from "@convex/schema";

/**
 * The load-bearing invariant of the data model: no table anywhere holds a
 * GitHub credential. This test walks the real schema validators rather than
 * reading the source, so adding a token field later fails here.
 */

type ValidatorJson = {
  type: string;
  value?: unknown;
  fieldType?: ValidatorJson;
  optional?: boolean;
};

/** Collect every field name declared anywhere in a validator tree. */
function fieldNames(node: unknown, into: Set<string> = new Set()): Set<string> {
  if (!node || typeof node !== "object") return into;
  const json = node as ValidatorJson;

  if (json.type === "object" && json.value && typeof json.value === "object") {
    for (const [name, field] of Object.entries(
      json.value as Record<string, ValidatorJson>,
    )) {
      into.add(name);
      fieldNames(field.fieldType, into);
    }
    return into;
  }

  if (json.type === "union" && Array.isArray(json.value)) {
    for (const member of json.value) fieldNames(member, into);
    return into;
  }

  if (json.type === "array") {
    fieldNames(json.value, into);
    return into;
  }

  if (json.type === "record" && json.value && typeof json.value === "object") {
    const record = json.value as { values?: { fieldType?: ValidatorJson } };
    fieldNames(record.values?.fieldType, into);
  }

  return into;
}

// `json` is the runtime serialisation of a validator. It is not on the public
// type, so the cast goes through `unknown`.
const tables = schema.tables as unknown as Record<
  string,
  { validator: { json: ValidatorJson } }
>;

describe("schema", () => {
  it("declares every table the demo needs", () => {
    expect(Object.keys(tables).sort()).toEqual([
      "actions",
      "auditLog",
      "connections",
      "runEvents",
      "runs",
      "users",
    ]);
  });

  it("holds no field that could store a GitHub credential", () => {
    const forbidden =
      /(access_?token|refresh_?token|^token$|bearer|secret|credential|client_?secret|api_?key|private_?key)/i;

    for (const [table, definition] of Object.entries(tables)) {
      const names = [...fieldNames(definition.validator.json)];
      expect(names.length).toBeGreaterThan(0);
      const offenders = names.filter((name) => forbidden.test(name));
      expect(
        offenders,
        `table "${table}" declares credential-shaped fields: ${offenders.join(", ")}`,
      ).toEqual([]);
    }
  });

  it("carries a correlationId on the audit log and the run timeline", () => {
    expect([...fieldNames(tables.auditLog.validator.json)]).toContain(
      "correlationId",
    );
    expect([...fieldNames(tables.runs.validator.json)]).toContain(
      "correlationId",
    );
    expect([...fieldNames(tables.runEvents.validator.json)]).toContain(
      "correlationId",
    );
  });
});
