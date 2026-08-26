import { redirect } from "next/navigation";

import { getCurrentAuthSession } from "../../../lib/auth/server";
import { ChangePasswordForm } from "./change-password-form";
import { logoutAction } from "../../auth-actions";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const session = await getCurrentAuthSession();
  if (!session) redirect("/login");
  if (!session.mustChangePassword) redirect("/");
  return (
    <main className="login-shell">
      <section className="login-card password-change-card">
        <div className="login-brand"><span>S</span><strong>SISPL</strong></div>
        <p className="eyebrow">FIRST SIGN-IN</p>
        <h1>Create your permanent password</h1>
        <p className="login-intro">Welcome, {session.fullName}. Replace the temporary password before entering your firm workspace.</p>
        <ChangePasswordForm />
        <form action={logoutAction} className="password-change-logout"><button className="secondary-button" type="submit">Sign out instead</button></form>
      </section>
    </main>
  );
}
