"use client";

import { useEffect } from "react";

/**
 * The error state for the console.
 *
 * It shows what failed and gives one recovery action. It shows no stack trace,
 * because a trace can contain data that must stay on the server.
 */
export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[console]", error.message);
  }, [error]);

  return (
    <main className="wrap" style={{ maxWidth: "34rem", paddingTop: "5rem" }}>
      <div className="panel">
        <h2>The page did not load</h2>
        <p className="small">
          The application could not show this page. The most usual cause is a
          missing configuration value.
        </p>
        <p className="muted small mono">{error.message}</p>
        <div className="row">
          <button type="button" className="primary" onClick={reset}>
            Try again
          </button>
          <a className="button" href="/api/health">
            Check the configuration
          </a>
        </div>
      </div>
    </main>
  );
}
