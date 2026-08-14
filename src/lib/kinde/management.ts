import { kindeManagementEnv } from "@/lib/env";

/**
 * A thin client for the Kinde Management API.
 *
 * The machine-to-machine client credentials in here belong to Kinde, not to
 * GitHub. They are never written to a database and never logged.
 */

export class KindeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "KindeApiError";
  }
}

/**
 * Exchange the M2M client credentials for a Management API access token.
 *
 * This token is scoped to the Kinde Management API. It is held for the length
 * of one call and then dropped.
 */
export async function getManagementToken(): Promise<string> {
  const env = kindeManagementEnv();

  const response = await fetch(`${env.KINDE_ISSUER_URL}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.KINDE_M2M_CLIENT_ID,
      client_secret: env.KINDE_M2M_CLIENT_SECRET,
      audience: env.KINDE_MANAGEMENT_AUDIENCE,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new KindeApiError(
      `Kinde refused the management client credentials (HTTP ${response.status}).`,
      response.status,
      "/oauth2/token",
      await safeBody(response),
    );
  }

  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new KindeApiError(
      "Kinde returned no management access token.",
      response.status,
      "/oauth2/token",
    );
  }
  return payload.access_token;
}

export interface ManagementRequest {
  path: string;
  method?: "GET" | "POST" | "DELETE" | "PATCH";
  query?: Record<string, string | undefined>;
  /** A management token already in hand, to avoid a second exchange. */
  token?: string;
}

export interface ManagementResponse<T> {
  status: number;
  ok: boolean;
  body: T;
  /** Round-trip time in milliseconds, used by the revocation measurements. */
  durationMs: number;
}

/**
 * Call the Management API and return the raw outcome, including failures.
 *
 * Failures are returned rather than thrown so that callers can measure a
 * refusal — a refusal is a result the demo cares about, not an accident.
 */
export async function managementRequest<T = unknown>(
  request: ManagementRequest,
): Promise<ManagementResponse<T>> {
  const env = kindeManagementEnv();
  const token = request.token ?? (await getManagementToken());

  const url = new URL(request.path, env.KINDE_ISSUER_URL);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }

  const startedAt = performance.now();
  const response = await fetch(url, {
    method: request.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    cache: "no-store",
  });
  const durationMs = Math.round(performance.now() - startedAt);

  return {
    status: response.status,
    ok: response.ok,
    body: (await safeBody(response)) as T,
    durationMs,
  };
}

async function safeBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
