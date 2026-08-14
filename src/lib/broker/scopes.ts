/**
 * Compare what an action needs against what the connection actually grants.
 *
 * GitHub reports the token's scopes on every response. Comparing them to the
 * registry's claim catches two different problems:
 *
 *   - **missing** — the connection grants less than the action needs. The
 *     action will fail, and the registry is claiming a scope the connection
 *     does not hold.
 *   - **excess** — the connection grants more than the action needs. Nothing
 *     breaks, but the blast radius is larger than the work requires. This is
 *     what stored-key mode looks like in practice: a token that carries
 *     whatever was convenient rather than what the task needs.
 */

export interface ScopeComparison {
  sufficient: boolean;
  missing: string[];
  excess: string[];
  /** Null when GitHub reported no scopes, which is not the same as none. */
  granted: string[] | null;
}

export function compareScopes(
  required: readonly string[],
  granted: readonly string[] | null | undefined,
): ScopeComparison {
  if (!granted || granted.length === 0) {
    return { sufficient: true, missing: [], excess: [], granted: null };
  }

  const grantedSet = new Set(granted);
  const requiredSet = new Set(required);

  // `repo` implies `public_repo` at GitHub, so it satisfies the requirement
  // while still counting as excess privilege.
  const satisfies = (scope: string): boolean =>
    grantedSet.has(scope) || (scope === "public_repo" && grantedSet.has("repo"));

  const missing = [...requiredSet].filter((scope) => !satisfies(scope));
  const excess = [...grantedSet].filter((scope) => !requiredSet.has(scope));

  return {
    sufficient: missing.length === 0,
    missing,
    excess,
    granted: [...granted],
  };
}

/** A short, human-readable note for the audit trail. Never a credential. */
export function describeScopes(comparison: ScopeComparison): string | null {
  if (comparison.granted === null) return null;
  if (comparison.missing.length > 0) {
    return `Scope shortfall: the connection is missing ${comparison.missing.join(", ")}.`;
  }
  if (comparison.excess.length > 0) {
    return `Over-privileged: the credential also carries ${comparison.excess.join(", ")}, which this action does not need.`;
  }
  return "Least privilege holds: the credential carries exactly what the action needs.";
}
