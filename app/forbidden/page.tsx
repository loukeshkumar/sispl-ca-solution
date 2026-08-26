import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main className="login-shell">
      <section className="login-card" role="alert">
        <div className="login-brand"><span>S</span><strong>SISPL</strong></div>
        <p className="eyebrow">ACCESS RESTRICTED</p>
        <h1>Permission required</h1>
        <p className="login-intro">Your account is active, but its firm role does not allow this workspace.</p>
        <Link className="login-submit login-link" href="/">Return to dashboard</Link>
      </section>
    </main>
  );
}
