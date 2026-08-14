import { z } from "zod";
import { resolveStorageMode, type StorageMode } from "./storage-mode";

/**
 * Server-side environment configuration.
 *
 * Every Kinde parameter, the OpenAI model id and the storage mode come from
 * here. Nothing in this file is ever hardcoded to a deployment and nothing in
 * this file is ever sent to the browser.
 *
 * Groups are validated lazily so that the app boots — and the health route
 * answers — before the later groups are configured.
 */

function assertServer(group: string): void {
  if (typeof window !== "undefined") {
    throw new Error(
      `env.${group} was read in the browser. Server configuration must never reach the client.`,
    );
  }
}

function read<T extends z.ZodTypeAny>(
  group: string,
  schema: T,
  source: Record<string, string | undefined>,
): z.infer<T> {
  assertServer(group);
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    throw new Error(
      `Environment group "${group}" is not configured. Check: ${missing}. See .env.example.`,
    );
  }
  return parsed.data;
}

const nonEmpty = z.string().min(1);
const httpsUrl = z.string().url();

/* ------------------------------------------------------------------ app -- */

const appSchema = z.object({
  APP_BASE_URL: httpsUrl,
});

export function appEnv() {
  return read("app", appSchema, {
    APP_BASE_URL: process.env.APP_BASE_URL,
  });
}

/**
 * The storage mode for this deployment. Server-decided, environment-only.
 */
export function storageMode(): StorageMode {
  assertServer("storageMode");
  return resolveStorageMode(process.env.STORAGE_MODE);
}

/* ---------------------------------------------------------------- kinde -- */

/** The Kinde back-end web app that signs the user into this demo. */
const kindeAuthSchema = z.object({
  KINDE_ISSUER_URL: httpsUrl,
  KINDE_CLIENT_ID: nonEmpty,
  KINDE_CLIENT_SECRET: nonEmpty,
  KINDE_SITE_URL: httpsUrl,
  KINDE_POST_LOGIN_REDIRECT_URL: httpsUrl,
  KINDE_POST_LOGOUT_REDIRECT_URL: httpsUrl,
});

export function kindeAuthEnv() {
  return read("kinde.auth", kindeAuthSchema, {
    KINDE_ISSUER_URL: process.env.KINDE_ISSUER_URL,
    KINDE_CLIENT_ID: process.env.KINDE_CLIENT_ID,
    KINDE_CLIENT_SECRET: process.env.KINDE_CLIENT_SECRET,
    KINDE_SITE_URL: process.env.KINDE_SITE_URL,
    KINDE_POST_LOGIN_REDIRECT_URL: process.env.KINDE_POST_LOGIN_REDIRECT_URL,
    KINDE_POST_LOGOUT_REDIRECT_URL: process.env.KINDE_POST_LOGOUT_REDIRECT_URL,
  });
}

/**
 * The Kinde machine-to-machine app used to call the Management API:
 * connected app auth urls, connected app tokens and revocation.
 */
const kindeManagementSchema = z.object({
  KINDE_ISSUER_URL: httpsUrl,
  KINDE_M2M_CLIENT_ID: nonEmpty,
  KINDE_M2M_CLIENT_SECRET: nonEmpty,
  KINDE_MANAGEMENT_AUDIENCE: nonEmpty,
  KINDE_GITHUB_CONNECTED_APP_KEY: nonEmpty,
});

export function kindeManagementEnv() {
  return read("kinde.management", kindeManagementSchema, {
    KINDE_ISSUER_URL: process.env.KINDE_ISSUER_URL,
    KINDE_M2M_CLIENT_ID: process.env.KINDE_M2M_CLIENT_ID,
    KINDE_M2M_CLIENT_SECRET: process.env.KINDE_M2M_CLIENT_SECRET,
    KINDE_MANAGEMENT_AUDIENCE: process.env.KINDE_MANAGEMENT_AUDIENCE,
    KINDE_GITHUB_CONNECTED_APP_KEY: process.env.KINDE_GITHUB_CONNECTED_APP_KEY,
  });
}

/* --------------------------------------------------------------- openai -- */

const openAiSchema = z.object({
  OPENAI_API_KEY: nonEmpty,
  OPENAI_MODEL: nonEmpty,
});

export function openAiEnv() {
  return read("openai", openAiSchema, {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
  });
}

/* --------------------------------------------------------------- github -- */

/** The repository the demo acts on. */
const gitHubTargetSchema = z.object({
  GITHUB_TARGET_OWNER: nonEmpty,
  GITHUB_TARGET_REPO: nonEmpty,
});

export function gitHubTargetEnv() {
  return read("github.target", gitHubTargetSchema, {
    GITHUB_TARGET_OWNER: process.env.GITHUB_TARGET_OWNER,
    GITHUB_TARGET_REPO: process.env.GITHUB_TARGET_REPO,
  });
}

/**
 * The app's own long-lived GitHub token. This exists only to demonstrate the
 * unsafe `stored-key` mode. It is read by the broker and by nothing else, and
 * only when the deployment is in `stored-key` mode.
 */
const storedKeySchema = z.object({
  GITHUB_STORED_TOKEN: nonEmpty,
});

export function storedKeyEnv() {
  return read("github.storedKey", storedKeySchema, {
    GITHUB_STORED_TOKEN: process.env.GITHUB_STORED_TOKEN,
  });
}

/* --------------------------------------------------------------- convex -- */

const convexSchema = z.object({
  NEXT_PUBLIC_CONVEX_URL: httpsUrl,
});

export function convexEnv() {
  return read("convex", convexSchema, {
    NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
  });
}

/* ------------------------------------------------------------- readiness -- */

export type GroupName =
  | "app"
  | "convex"
  | "kinde.auth"
  | "kinde.management"
  | "openai"
  | "github.target";

const groups: Record<GroupName, () => unknown> = {
  app: appEnv,
  convex: convexEnv,
  "kinde.auth": kindeAuthEnv,
  "kinde.management": kindeManagementEnv,
  openai: openAiEnv,
  "github.target": gitHubTargetEnv,
};

/**
 * Report which configuration groups are present. Names only — never values.
 */
export function configuredGroups(): Record<GroupName, boolean> {
  const out = {} as Record<GroupName, boolean>;
  for (const [name, load] of Object.entries(groups) as [
    GroupName,
    () => unknown,
  ][]) {
    try {
      load();
      out[name] = true;
    } catch {
      out[name] = false;
    }
  }
  return out;
}
