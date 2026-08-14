import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { convexServerClient, convexServerSecret } from "./convex-server";

/**
 * The signed-in operator, resolved on the server.
 *
 * The Kinde subject is the identity the broker acts for. It is not a
 * credential: on its own it grants nothing, and it is the only piece of user
 * context the agent ever carries.
 */

export interface Operator {
  kindeUserId: string;
  email: string | null;
  name: string | null;
  userId: Id<"users">;
  connection: Doc<"connections"> | null;
}

/** The operator, or null when nobody is signed in. */
export async function currentOperator(): Promise<Operator | null> {
  const { getUser, isAuthenticated } = getKindeServerSession();

  if (!(await isAuthenticated())) return null;
  const kindeUser = await getUser();
  if (!kindeUser?.id) return null;

  const convex = convexServerClient();
  const secret = convexServerSecret();

  const name =
    [kindeUser.given_name, kindeUser.family_name].filter(Boolean).join(" ") ||
    null;

  // Record the user on first sight so the broker and the audit trail have
  // something to hang rows off.
  const userId = await convex.mutation(api.gateway.upsertUser, {
    secret,
    kindeUserId: kindeUser.id,
    email: kindeUser.email ?? undefined,
    name: name ?? undefined,
  });

  const { connection } = await convex.query(api.gateway.brokerContext, {
    secret,
    kindeUserId: kindeUser.id,
  });

  return {
    kindeUserId: kindeUser.id,
    email: kindeUser.email ?? null,
    name,
    userId,
    connection,
  };
}

/** The operator, or a thrown error. For routes that require a session. */
export async function requireOperator(): Promise<Operator> {
  const operator = await currentOperator();
  if (!operator) throw new Error("Not signed in.");
  return operator;
}
