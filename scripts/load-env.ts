import { config } from "dotenv";

/**
 * Environment loading for the scripts.
 *
 * `.env.local` holds the deployment's configuration. The app's own long-lived
 * GitHub token lives somewhere else entirely: `.env.stored-key`, loaded only
 * when the deployment is in stored-key mode.
 *
 * That separation is not tidiness. `prove-no-stored-token.ts` scans the
 * process environment for a credential, and the connected-app run has to be
 * able to come back genuinely clean. If the stored token sat in `.env.local`
 * it would be loaded into every run, and the proof would be worthless —
 * a connected-app deployment holds no GitHub token, so its environment must
 * really contain none.
 */
config({ path: [".env.local", ".env"], quiet: true });

if (process.env.STORAGE_MODE === "stored-key") {
  config({ path: [".env.stored-key"], quiet: true });
}
