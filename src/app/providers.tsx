"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

/**
 * The browser's live connection to Convex, used for the timeline, the audit
 * trail and the metric block.
 *
 * Only the deployment URL crosses to the client. The server secret that guards
 * every write stays on the server, so the browser can read what happened but
 * cannot forge an audit row, mark a connection linked, or change the mode.
 */

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const client = url ? new ConvexReactClient(url) : null;

export function Providers({ children }: { children: ReactNode }) {
  if (!client) return <>{children}</>;
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
