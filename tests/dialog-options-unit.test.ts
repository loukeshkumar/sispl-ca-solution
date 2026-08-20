import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

/**
 * Every option-backed dialog shares this hook, so a fault here empties nine
 * dialogs at once — with no error, because nothing throws. The dialog simply
 * renders its header and nothing else.
 */
test("a discarded StrictMode invocation cannot silence the real one", async () => {
  const source = await read("../app/dashboard/use-dialog-options.ts");

  // The fault: an `inFlight` re-entry guard. React invokes the effect twice in
  // development. The first invocation sets the guard and is then cancelled; the
  // second bails out because the promise has not settled, so no load ever
  // writes state and the dialog stays blank forever.
  assert.doesNotMatch(source, /inFlight\.current/, "an in-flight re-entry guard deadlocks the second invocation");

  // The fix: schedule the fetch a tick later so a discarded invocation is
  // cancelled before it starts, and let only the newest ticket write state.
  assert.match(source, /const ticket = \(latest\.current \+= 1\)/);
  assert.match(source, /if \(latest\.current !== ticket\) return/);
  assert.match(source, /setTimeout\(/);
  assert.match(source, /return \(\) => clearTimeout\(timer\)/);

  // A cancelled-boolean would reintroduce the same silencing.
  assert.doesNotMatch(source, /let cancelled =/, "a per-effect cancelled flag silences the surviving load");

  // Reopening must not refetch what is already held.
  assert.match(source, /if \(!open \|\| loaded\.current\) return/);
  assert.match(source, /loaded\.current = true/);
});

test("a redirect from the loader reaches the router, not the dialog", async () => {
  const source = await read("../app/dashboard/use-dialog-options.ts");
  // Loaders begin with requirePermission, which signals by throwing. Swallowing
  // that leaves an expired session staring at "the form could not be loaded"
  // inside a dialog that can never succeed.
  assert.match(source, /import \{ unstable_rethrow \} from "next\/navigation"/);
  const starts = [...source.matchAll(/\.catch\(\(error: unknown\) => \{/g)].map((match) => match.index ?? 0);
  assert.equal(starts.length, 2, "the initial load and the retry both need it");
  for (const start of starts) {
    const rethrow = source.indexOf("unstable_rethrow(error)", start);
    const handled = source.indexOf("setState(", start);
    assert.ok(rethrow > start, "every catch must let control-flow errors through");
    // Rethrow first: anything after it only runs for a genuine failure.
    assert.ok(rethrow < handled, "rethrow must come before the failure is handled");
  }
  // The reason is logged by type only, never the message, so a database error
  // cannot leak a query or a parameter.
  assert.match(source, /errorType: error instanceof Error \? error\.name : "UnknownError"/);
  assert.doesNotMatch(source, /error\.message/);
});

test("every dialog that loads options can recover from a failure", async () => {
  const source = await read("../app/dashboard/use-dialog-options.ts");
  assert.match(source, /failed: true/);
  assert.match(source, /retry:/);
  // Retry clears the cache, or it would resolve instantly against stale data.
  assert.match(source, /loaded\.current = false/);
});

test("capture reuses the single file input rather than adding a second", async () => {
  const source = await read("../app/documents/upload-form.tsx");
  assert.match(source, /capture", "environment"/);
  assert.match(source, /input\.click\(\)/);
  // Two inputs sharing a name would both post and the empty one could win.
  assert.equal((source.match(/name="document"/g) ?? []).length, 1, "there must be exactly one document input");
  // The picker must come back, or a later upload is stuck on images only.
  assert.match(source, /input\.setAttribute\("accept", FILE_ACCEPT\)/);
  assert.match(source, /input\.removeAttribute\("capture"\)/);
});

test("the upload form files against the client's own services", async () => {
  const source = await read("../app/documents/upload-form.tsx");
  // Request and work lists are reconciled against the chosen client, so a
  // document cannot be filed against another client's service.
  assert.match(source, /reconcileDocumentUploadRelations/);
  assert.match(source, /available\.work\.map/);
  assert.match(source, /available\.requests\.map/);
  assert.match(source, /disabled=\{!selectedClientId\}/);
});
