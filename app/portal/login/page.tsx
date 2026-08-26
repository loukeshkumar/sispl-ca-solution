import { redirect } from "next/navigation";

import { resolveDataSource } from "../../../lib/dashboard/config";
import { getCurrentPortalSession } from "../../../lib/portal/server";
import PortalLoginForm from "./portal-login-form";

export const dynamic = "force-dynamic";

export default async function PortalLoginPage({ searchParams }: { searchParams: Promise<{ passwordChanged?: string }> }) {
  if (resolveDataSource(process.env) !== "postgres") redirect("/");
  const query = await searchParams;
  const session = await getCurrentPortalSession();
  if (session) redirect("/portal");
  return (
    <main className="portal-auth-shell">
      <section className="portal-auth-card">
        <span className="portal-brand"><b>S</b> SISPL <small>CLIENT PORTAL</small></span>
        <h1>Sign in</h1>
        <p>Access your compliance status, document requests, and invoices.</p>
        {query.passwordChanged === "1" && <p className="portal-notice" role="status">Your password was changed. Sign in with the new password.</p>}
        <PortalLoginForm />
      </section>
    </main>
  );
}
