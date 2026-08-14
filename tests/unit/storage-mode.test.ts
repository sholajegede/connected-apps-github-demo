import { describe, expect, it } from "vitest";
import {
  CONNECTED_APP,
  STORED_KEY,
  resolveStorageMode,
} from "@/lib/storage-mode";

describe("storage mode resolution", () => {
  it("selects the unsafe mode only on the exact value", () => {
    expect(resolveStorageMode("stored-key")).toBe(STORED_KEY);
  });

  it("falls back to the safe mode for everything else", () => {
    const others = [
      undefined,
      null,
      "",
      " ",
      "connected-app",
      "STORED-KEY",
      "Stored-Key",
      "stored_key",
      " stored-key",
      "stored-key ",
      "stored-key;connected-app",
      "true",
      "1",
    ];
    for (const value of others) {
      expect(resolveStorageMode(value)).toBe(CONNECTED_APP);
    }
  });
});
