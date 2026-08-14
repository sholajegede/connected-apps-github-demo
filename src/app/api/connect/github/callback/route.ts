import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where Kinde returns the user after they authorize GitHub.
 *
 * Nothing sensitive arrives here. Kinde completed the authorization on its own
 * side and now holds the GitHub grant. This app already knows the connected
 * app session id from the auth url call, so there is nothing to capture and no
 * token in this request.
 */
export function GET(request: Request) {
  const url = new URL(request.url);
  const failed = url.searchParams.has("error");

  const body = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${failed ? "GitHub not connected" : "GitHub connected"}</title>
<style>
  body { font: 16px/1.55 ui-sans-serif, system-ui, sans-serif; margin: 0;
         display: grid; place-items: center; min-height: 100vh;
         background: #0e0e11; color: #f2f2f5; }
  main { max-width: 32rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  p { color: #9a9aa5; margin: 0 0 1.5rem; }
  a { color: #6ea8ff; }
</style>
<main>
  <h1>${failed ? "GitHub was not connected" : "GitHub is connected"}</h1>
  <p>${
    failed
      ? "The authorization did not complete. You can close this tab and try again."
      : "Kinde holds the authorization. This app stores no GitHub token. You can close this tab."
  }</p>
  <a href="/">Back to the console</a>
</main>`;

  return new NextResponse(body, {
    status: failed ? 400 : 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
