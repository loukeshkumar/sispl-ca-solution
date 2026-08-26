import Link from "next/link";

export default function NotFound() {
  return (
    <main className="boundary-shell">
      <section className="boundary-card">
        <p className="eyebrow">NOT FOUND</p>
        <h1>That page is not available</h1>
        <p>The record may have been archived, or the link may be out of date. Nothing was changed.</p>
        <Link className="primary-button" href="/">Back to the workspace</Link>
      </section>
    </main>
  );
}
