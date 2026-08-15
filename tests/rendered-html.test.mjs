import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders SISPL product metadata and a host-derived social preview", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("https://sispl.example/", {
      headers: {
        accept: "text/html",
        "x-forwarded-host": "sispl.example",
        "x-forwarded-proto": "https",
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>SISPL CA Solution[^<]*<\/title>/i);
  assert.match(html, /Practice command centre for Indian chartered accountants/i);
  assert.match(html, /property=["']og:image["'][^>]*content=["']https:\/\/sispl\.example\/og\.png["']/i);
  assert.doesNotMatch(html, developmentPreviewMeta);
});
