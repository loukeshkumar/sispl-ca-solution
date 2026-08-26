"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Renders when a page throws. The message stays generic on purpose: an error can
 * carry query fragments or identifiers, and this boundary is reachable by anyone.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Workspace render failed.", { errorType: error.name, digest: error.digest });
  }, [error]);

  return (
    <main className="boundary-shell">
      <section className="boundary-card">
        <p className="eyebrow">SOMETHING WENT WRONG</p>
        <h1>This view could not be displayed</h1>
        <p>No changes were saved. Try again, and if it keeps happening give your administrator the reference below.</p>
        {error.digest && <code className="boundary-digest">{error.digest}</code>}
        <div className="boundary-actions">
          <button className="primary-button" onClick={reset} type="button">Try again</button>
          <Link className="secondary-button" href="/">Back to the workspace</Link>
        </div>
      </section>
    </main>
  );
}
