import { redirect } from "next/navigation";

import { resolveDataSource } from "../../lib/dashboard/config";
import { getCurrentAuthSession } from "../../lib/auth/server";
import { safeReturnPath } from "../../lib/auth/redirects";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ passwordChanged?: string; returnTo?: string }>;
}) {
  if (resolveDataSource(process.env) !== "postgres") redirect("/");

  const query = await searchParams;
  const returnTo = safeReturnPath(query.returnTo);
  let existingSession = null;
  try {
    existingSession = await getCurrentAuthSession();
  } catch {
    // Keep the sign-in screen available with a safe database error from the action.
  }
  if (existingSession) redirect(returnTo);

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand"><span>S</span><strong>SISPL</strong></div>
        <p className="eyebrow">SECURE PRACTICE ACCESS</p>
        <h1>Welcome back</h1>
        <p className="login-intro">Sign in to your firm workspace. Access is limited by active membership and role.</p>
        {query.passwordChanged === "1" && <p className="login-success" role="status">Your permanent password is ready. Sign in again to continue.</p>}
        <LoginForm returnTo={returnTo} />
        <p className="login-help">Local PostgreSQL authentication · Eight-hour session</p>
      </section>
    </main>
  );
}
