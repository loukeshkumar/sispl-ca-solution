import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { formatPaise } from "../../lib/payroll/money";
import { getPortalOverview } from "../../lib/portal/repository";
import { requirePortalSession } from "../../lib/portal/server";
import { portalLogoutAction } from "./actions";
import PortalUploadForm from "./portal-upload-form";

export const dynamic = "force-dynamic";

const statusLabels: Record<string, string> = {
  critical: "Needs attention",
  at_risk: "In progress",
  waiting: "Awaiting your documents",
  review: "In review",
  completed: "Filed",
};

function dueLabel(dateKey: string, todayKey: string) {
  if (dateKey < todayKey) return { text: "Overdue", tone: "overdue" };
  if (dateKey === todayKey) return { text: "Due today", tone: "soon" };
  const days = Math.round((Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 86_400_000);
  return { text: `${days} day${days === 1 ? "" : "s"} left`, tone: days <= 3 ? "soon" : "normal" };
}

export default async function PortalHomePage({ searchParams }: { searchParams: Promise<{ uploaded?: string }> }) {
  const session = await requirePortalSession();
  const query = await searchParams;
  const overview = await getPortalOverview(getDatabase(), session.tenantId, session.legalEntityId);
  const openRequests = overview.requests.filter((request) => request.status === "requested");

  return (
    <div className="portal-shell">
      <header className="portal-header">
        <span className="portal-brand"><b>S</b> SISPL <small>CLIENT PORTAL</small></span>
        <div className="portal-identity">
          <span><strong>{session.clientName}</strong><small>{session.fullName} · {session.tenantName}</small></span>
          <form action={portalLogoutAction}><button className="portal-signout" type="submit">Sign out</button></form>
        </div>
      </header>

      <main className="portal-main">
        {query.uploaded === "1" && <p className="portal-notice" role="status">Thank you — your document was received.</p>}

        <section className="portal-kpis">
          <article><span>Documents requested</span><strong>{overview.metrics.openRequests}</strong><small>{overview.metrics.overdueRequests} overdue</small></article>
          <article><span>Active obligations</span><strong>{overview.metrics.upcomingObligations}</strong><small>Tracked by your firm</small></article>
          <article><span>Outstanding invoices</span><strong>{formatPaise(overview.metrics.outstandingPaise)}</strong><small>Issued and unpaid</small></article>
        </section>

        <section className="portal-panel">
          <h2>Documents your firm needs</h2>
          {openRequests.length === 0 ? (
            <p className="portal-empty">Nothing is pending. We will let you know when something is needed.</p>
          ) : (
            <ul className="portal-request-list">
              {openRequests.map((request) => {
                const due = dueLabel(request.dueDate, overview.todayKey);
                return (
                  <li key={request.id}>
                    <div>
                      <strong>{request.title}</strong>
                      {request.description && <p>{request.description}</p>}
                      <small>Due {request.dueDate} · <b className={`portal-due portal-due-${due.tone}`}>{due.text}</b></small>
                    </div>
                    <PortalUploadForm requestId={request.id} requestTitle={request.title} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="portal-panel">
          <h2>Your compliance status</h2>
          {overview.obligations.length === 0 ? (
            <p className="portal-empty">No obligations are being tracked yet.</p>
          ) : (
            <div className="portal-table-wrap">
              <table className="portal-table">
                <thead><tr><th>Service</th><th>Period</th><th>Statutory due</th><th>Status</th></tr></thead>
                <tbody>
                  {overview.obligations.map((obligation) => (
                    <tr key={obligation.id}>
                      <td>{obligation.serviceLabel}</td>
                      <td>{obligation.periodKey}</td>
                      <td>{obligation.statutoryDueDate}</td>
                      <td><span className={`portal-status portal-status-${obligation.status}`}>{statusLabels[obligation.status] ?? obligation.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="portal-footnote">Status reflects your firm&rsquo;s internal tracking. It is not an acknowledgement from a government portal.</p>
        </section>

        <section className="portal-panel">
          <h2>Invoices</h2>
          {overview.invoices.length === 0 ? (
            <p className="portal-empty">No invoices have been issued yet.</p>
          ) : (
            <div className="portal-table-wrap">
              <table className="portal-table">
                <thead><tr><th>Invoice</th><th>Period</th><th>Issued</th><th>Due</th><th className="portal-amount">Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {overview.invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>{invoice.invoiceNumber}</td>
                      <td>{invoice.periodLabel}</td>
                      <td>{invoice.issueDate ?? "—"}</td>
                      <td>{invoice.dueDate ?? "—"}</td>
                      <td className="portal-amount">{formatPaise(invoice.totalPaise)}</td>
                      <td><span className={`portal-status portal-status-${invoice.status}`}>{invoice.status === "paid" ? "Paid" : "Payable"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
