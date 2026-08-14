/**
 * A correlationId ties a run, its timeline and its audit rows together. It is
 * generated once per run and carried through every brokered action and every
 * revocation that run causes.
 */

const PREFIX = "cid";

export function newCorrelationId(): string {
  return `${PREFIX}_${crypto.randomUUID()}`;
}

export function isCorrelationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    new RegExp(
      `^${PREFIX}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
    ).test(value)
  );
}
