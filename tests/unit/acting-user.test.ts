import { describe, expect, it } from "vitest";
import { actingUserFrom } from "@/lib/github/acting-user";

describe("acting user", () => {
  it("reads the login from a comment response", () => {
    // POST /repos/{o}/{r}/issues/{n}/comments
    expect(
      actingUserFrom({
        id: 99887766,
        body: "Looks right to me.",
        user: { login: "octo-person", id: 4242 },
      }),
    ).toEqual({ login: "octo-person", id: 4242 });
  });

  it("reads the login from a pull request response", () => {
    // POST /repos/{o}/{r}/pulls
    expect(
      actingUserFrom({
        number: 7,
        title: "Add an example configuration file",
        user: { login: "octo-person", id: 4242 },
      }),
    ).toEqual({ login: "octo-person", id: 4242 });
  });

  it("reads the login from a top-level user response", () => {
    // GET /user — needs no scope at all.
    expect(actingUserFrom({ login: "octo-person", id: 4242 })).toEqual({
      login: "octo-person",
      id: 4242,
    });
  });

  it("prefers the nested user over a same-level login", () => {
    // An issue body carries the issue author at `user`, which is the acting
    // account for a comment response. A stray top-level `login` must not win.
    expect(
      actingUserFrom({ login: "not-the-actor", user: { login: "the-actor" } }),
    ).toEqual({ login: "the-actor", id: null });
  });

  it("returns null when the response carries no identity", () => {
    for (const payload of [
      null,
      undefined,
      "octo-person",
      42,
      {},
      { user: null },
      { user: {} },
      { login: 12345 },
      { user: { login: false } },
      [{ number: 1 }],
    ]) {
      expect(actingUserFrom(payload)).toBeNull();
    }
  });

  it("tolerates a missing numeric id", () => {
    expect(actingUserFrom({ user: { login: "octo-person" } })).toEqual({
      login: "octo-person",
      id: null,
    });
  });
});
