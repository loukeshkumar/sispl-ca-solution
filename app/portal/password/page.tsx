import { requirePortalSession } from "../../../lib/portal/server";
import PortalPasswordForm from "./portal-password-form";

export const dynamic = "force-dynamic";

export default async function PortalPasswordPage() {
  const session = await requirePortalSession({ allowPasswordChange: true });
  return (
    <main className="portal-auth-shell">
      <section className="portal-auth-card">
        <span className="portal-brand"><b>S</b> SISPL <small>CLIENT PORTAL</small></span>
        <h1>Create a permanent password</h1>
        <p>{session.fullName}, replace the temporary password issued by {session.tenantName} before continuing.</p>
        <PortalPasswordForm />
      </section>
    </main>
  );
}
