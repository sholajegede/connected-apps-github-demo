import { convexTest } from "convex-test";
import schema from "@convex/schema";

/**
 * convex-test needs the Convex function modules handed to it. Type
 * declarations are not modules, so they are filtered out.
 */
const all = import.meta.glob("../../convex/**/*.{ts,js}");

const modules = Object.fromEntries(
  Object.entries(all).filter(([path]) => !path.endsWith(".d.ts")),
);

export function harness() {
  return convexTest(schema, modules);
}
