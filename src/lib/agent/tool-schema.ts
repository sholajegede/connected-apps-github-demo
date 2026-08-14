import { z } from "zod";
import { listActions, type ActionDefinition } from "@/lib/actions/registry";

/**
 * The agent's tools, derived from the action registry.
 *
 * The registry is the single source of truth for what the agent may attempt.
 * Deriving the tool list from it rather than writing a parallel list means the
 * agent cannot be handed a capability that the registry does not define — and
 * cannot drift out of step with the validation the broker applies.
 */

export interface JsonSchema {
  type?: string;
  description?: string;
  enum?: readonly string[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
}

function unwrap(schema: z.ZodTypeAny): {
  inner: z.ZodTypeAny;
  hasDefault: boolean;
} {
  let inner = schema;
  let hasDefault = false;

  for (;;) {
    if (inner instanceof z.ZodDefault) {
      hasDefault = true;
      inner = inner._def.innerType as z.ZodTypeAny;
      continue;
    }
    if (inner instanceof z.ZodOptional) {
      hasDefault = true;
      inner = inner._def.innerType as z.ZodTypeAny;
      continue;
    }
    break;
  }

  return { inner, hasDefault };
}

function isInteger(schema: z.ZodNumber): boolean {
  const checks = (schema._def as { checks?: { kind?: string }[] }).checks ?? [];
  return checks.some((check) => check.kind === "int");
}

export function toJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const { inner } = unwrap(schema);
  const out: JsonSchema = {};

  const description = schema.description ?? inner.description;
  if (description) out.description = description;

  if (inner instanceof z.ZodString) {
    out.type = "string";
  } else if (inner instanceof z.ZodNumber) {
    out.type = isInteger(inner) ? "integer" : "number";
  } else if (inner instanceof z.ZodBoolean) {
    out.type = "boolean";
  } else if (inner instanceof z.ZodEnum) {
    out.type = "string";
    out.enum = inner.options as readonly string[];
  } else if (inner instanceof z.ZodArray) {
    out.type = "array";
    out.items = toJsonSchema(inner._def.type as z.ZodTypeAny);
  } else if (inner instanceof z.ZodObject) {
    const shape = inner.shape as Record<string, z.ZodTypeAny>;
    out.type = "object";
    out.properties = {};
    out.required = [];
    out.additionalProperties = false;

    for (const [key, value] of Object.entries(shape)) {
      out.properties[key] = toJsonSchema(value);
      // A field with a default is optional to the caller: the registry fills
      // it in. Everything else the agent must supply.
      if (!unwrap(value).hasDefault) out.required.push(key);
    }
  } else {
    out.type = "string";
  }

  return out;
}

export interface AgentTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}

function describe(action: ActionDefinition): string {
  const effect =
    action.effect === "write"
      ? "This writes into the signed-in user's own GitHub account, under their name."
      : "This only reads; it changes nothing.";
  return `${action.description} ${effect}`;
}

/** Every registered action, as an OpenAI tool definition. */
export function agentTools(): AgentTool[] {
  return listActions().map((action) => ({
    type: "function",
    function: {
      name: action.id,
      description: describe(action),
      parameters: toJsonSchema(action.input),
    },
  }));
}
