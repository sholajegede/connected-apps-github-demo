/**
 * Look for anything shaped like a GitHub credential.
 *
 * Shared by `prove-no-stored-token.ts` and `e2e-narrative.ts` so both use the
 * same definition of "a credential". The patterns are deliberately broader
 * than this demo needs: they match every GitHub token prefix, not only the one
 * the connected app issues.
 */

export const CREDENTIAL_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "GitHub OAuth token (gho_)", pattern: /gho_[A-Za-z0-9]{16,}/ },
  { name: "GitHub PAT, classic (ghp_)", pattern: /ghp_[A-Za-z0-9]{16,}/ },
  { name: "GitHub user-to-server (ghu_)", pattern: /ghu_[A-Za-z0-9]{16,}/ },
  { name: "GitHub server-to-server (ghs_)", pattern: /ghs_[A-Za-z0-9]{16,}/ },
  { name: "GitHub refresh token (ghr_)", pattern: /ghr_[A-Za-z0-9]{16,}/ },
  { name: "GitHub fine-grained PAT", pattern: /github_pat_[A-Za-z0-9_]{20,}/ },
];

export interface Finding {
  where: string;
  what: string;
}

export function scan(where: string, text: string, into: Finding[]): void {
  for (const { name, pattern } of CREDENTIAL_PATTERNS) {
    if (pattern.test(text)) into.push({ where, what: name });
  }
}

/** Scan every value in the process environment. */
export function scanEnvironment(): Finding[] {
  const findings: Finding[] = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && value) scan(`env.${key}`, value, findings);
  }
  return findings;
}

/** Scan every row of every table in a store dump. */
export function scanStore(dump: Record<string, unknown[]>): Finding[] {
  const findings: Finding[] = [];
  for (const [table, rows] of Object.entries(dump)) {
    scan(`store.${table}`, JSON.stringify(rows), findings);
  }
  return findings;
}
