import { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { convexEnv } from "./env";

/**
 * The server's connection to Convex.
 *
 * Writes go through `convex/gateway.ts`, which requires the server secret. The
 * secret lives in the Next.js environment and on the Convex deployment, never
 * in the browser bundle.
 */

const secretSchema = z.object({ CONVEX_SERVER_SECRET: z.string().min(1) });

export function convexServerSecret(): string {
  const parsed = secretSchema.safeParse({
    CONVEX_SERVER_SECRET: process.env.CONVEX_SERVER_SECRET,
  });
  if (!parsed.success) {
    throw new Error(
      "CONVEX_SERVER_SECRET is not configured. The server cannot write to the store. See .env.example.",
    );
  }
  return parsed.data.CONVEX_SERVER_SECRET;
}

export function convexServerClient(): ConvexHttpClient {
  return new ConvexHttpClient(convexEnv().NEXT_PUBLIC_CONVEX_URL);
}
