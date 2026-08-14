import { storageMode } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const mode = storageMode();

  return (
    <main
      style={{
        maxWidth: "44rem",
        margin: "0 auto",
        padding: "4rem 1.5rem",
      }}
    >
      <h1 style={{ fontSize: "1.6rem", margin: "0 0 0.5rem" }}>
        Connected Apps GitHub Demo
      </h1>
      <p style={{ color: "var(--muted)", margin: "0 0 2rem" }}>
        An agent acts in a user&apos;s GitHub account through one token broker.
      </p>

      <dl
        style={{
          borderTop: "1px solid var(--line)",
          paddingTop: "1rem",
          display: "grid",
          gridTemplateColumns: "10rem 1fr",
          gap: "0.5rem 1rem",
          margin: 0,
        }}
      >
        <dt style={{ color: "var(--muted)" }}>Storage mode</dt>
        <dd style={{ margin: 0 }}>
          <code>{mode}</code>
        </dd>
        <dt style={{ color: "var(--muted)" }}>Health</dt>
        <dd style={{ margin: 0 }}>
          <a href="/api/health">/api/health</a>
        </dd>
      </dl>
    </main>
  );
}
