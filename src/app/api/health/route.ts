import { NextResponse } from "next/server";
import { configuredGroups, storageMode } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness and configuration readiness.
 *
 * Reports which configuration groups are present by name. It never reports a
 * value, so this route cannot leak a secret.
 */
export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "connected-apps-github-demo",
      storageMode: storageMode(),
      config: configuredGroups(),
      time: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
