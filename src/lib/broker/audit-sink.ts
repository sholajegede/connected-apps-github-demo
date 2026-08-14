import { appendFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The fallback audit sink.
 *
 * The rule is that no brokered action, refusal or revocation happens without a
 * record. If the store cannot take the row, the decision is not allowed to
 * proceed unrecorded — the broker refuses.
 *
 * A refusal alone would still lose the fact that the attempt happened, so the
 * row is written here first: an append-only JSON Lines file that can be
 * replayed into the store once it is reachable again. Recoverable, not lost.
 *
 * Nothing written here contains a credential. Rows are the same shape the
 * store holds, and the broker redacts details before they ever reach it.
 */

const SINK_FILE = resolve(process.cwd(), ".audit-fallback.jsonl");

export interface PendingAuditRow {
  correlationId: string;
  event: string;
  outcome: string;
  actionId?: string;
  storageMode: string;
  detail?: string;
  userId?: string;
  runId?: string;
}

export interface SinkOutcome {
  written: boolean;
  path: string;
  error?: string;
}

/**
 * Write one audit row to the fallback sink.
 *
 * Returns rather than throws: this is the last line of defence, and it must
 * not be the thing that raises a new error.
 */
export function writeToFallbackSink(
  row: PendingAuditRow,
  reason: string,
): SinkOutcome {
  const line = JSON.stringify({
    ...row,
    at: Date.now(),
    recordedAt: new Date().toISOString(),
    fallbackReason: reason,
  });

  try {
    appendFileSync(SINK_FILE, `${line}\n`, { encoding: "utf8", mode: 0o600 });
    return { written: true, path: SINK_FILE };
  } catch (error) {
    return {
      written: false,
      path: SINK_FILE,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function fallbackSinkPath(): string {
  return SINK_FILE;
}
