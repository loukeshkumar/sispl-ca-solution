import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "../../../lib/auth/authorization";
import { requirePermission } from "../../../lib/auth/server";
import { getDatabase } from "../../../lib/dashboard/postgres/pool";
import { getWorkItem360, workEditorFrom } from "../../../lib/work/repository";
import { workServiceLabel } from "../../../lib/work/validation";
import { listFilingAcknowledgements } from "../../../lib/filings/repository";
import { loadOptionalPanel } from "../../../lib/dashboard/optional-panel";
import { indiaDateKey } from "../../../lib/registers/repository";
import { ProgressBar } from "../../dashboard/dashboard-ui";
import { WorkDialogButton } from "../../dashboard/work-dialog";
import CompleteWorkForm from "../complete-work-form";
import FilingAcknowledgements from "../filing-acknowledgements";
import { StepPanel } from "../step-panel";
import { ReviewPanel } from "../review-panel";
import { listReviewRounds } from "../../../lib/reviews/repository";
import { listWorkItemSteps } from "../../../lib/procedures/repository";
import { DependencyPanel } from "../dependency-panel";
import { dependencyTargets, listDependencies } from "../../../lib/dependencies/repository";
import { extensionFor } from "../../../lib/compliance/client-schedule-repository";
import { listWorkEscalations } from "../../../lib/escalation/repository";

export const dynamic = "force-dynamic";

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

export default async function WorkItem360Page({ params }: { params: Promise<{ workItemId: string }> }) {
  const { workItemId } = await params;
  const session = await requirePermission("dashboard:read", `/work/${workItemId}`);
  const item = await getWorkItem360(getDatabase(), session.tenantId, workItemId);
  if (!item) notFound();
  const canWrite = hasPermission(session, "work:write");
  const completed = item.status === "completed";
  const steps = await listWorkItemSteps(getDatabase(), session.tenantId, workItemId);
  const rounds = await listReviewRounds(getDatabase(), session.tenantId, workItemId);
  // The open round names who was actually asked, which is not necessarily
  // whoever holds the reviewer field right now.
  const isReviewer = rounds.find((round) => round.outcome === null)?.reviewerUserId === session.userId;
  const dependencies = await listDependencies(getDatabase(), session.tenantId, workItemId);
  const targets = await dependencyTargets(getDatabase(), session.tenantId, workItemId, item.legalEntityId);
  // Only looked up where a date actually moved, so the ordinary item pays
  // nothing for a concept that does not apply to it.
  const extension = item.originalStatutoryDueDate
    ? await extensionFor(getDatabase(), session.tenantId, item.legalEntityId, item.serviceKey, item.periodKey)
    : null;
  const escalations = await listWorkEscalations(getDatabase(), session.tenantId, workItemId);
  const acknowledgements = await loadOptionalPanel("filing-acknowledgements", () => listFilingAcknowledgements(getDatabase(), session.tenantId, { workItemId }), []);

  return (
    <main className="work-360-shell">
      <header className="client-360-header">
        <Link href="/?workspace=work">← Back to My Work</Link>
        <div className="client-360-title-row">
          <div><p className="eyebrow">WORK ITEM 360</p><h1>{workServiceLabel(item.serviceKey)} · {item.periodKey}</h1><span className="work-360-client"><Link href={`/clients/${item.legalEntityId}`}>{item.clientName}</Link></span></div>
          {canWrite && !completed && <div className="client-360-actions"><WorkDialogButton initial={workEditorFrom(item) ?? undefined} title={`Edit ${item.clientName}`} variant="secondary" workItemId={item.id}>Edit work item</WorkDialogButton><CompleteWorkForm workItemId={item.id} /></div>}
        </div>
      </header>

      <DependencyPanel
        canWrite={canWrite}
        completed={completed}
        dependencies={dependencies}
        targets={targets}
        todayKey={indiaDateKey()}
        workItemId={workItemId}
      />
      <StepPanel canWrite={canWrite} locked={completed} steps={steps} />
      <ReviewPanel
        canWrite={canWrite}
        completed={completed}
        isReviewer={isReviewer}
        reviewerName={item.reviewerName}
        rounds={rounds}
        workItemId={workItemId}
      />

      <section className="work-360-grid">
        <article className="work-360-main surface-card">
          <div className="work-360-status-row"><span className={`work-status-pill work-status-${item.status}`}>{titleCase(item.status)}</span><strong>{item.progress}% complete</strong></div>
          <ProgressBar label="Work progress" value={item.progress} />
          <div className="client-360-detail-grid work-360-detail-grid">
            <div><span>Statutory due date</span><strong>{formatDate(item.statutoryDueDate)}</strong></div>
            <div><span>Internal due date</span><strong>{formatDate(item.internalDueDate)}</strong></div>
            <div><span>Outstanding</span><strong>{item.missingItemCount}</strong></div>
            <div><span>Assignee</span><strong>{item.assigneeName ?? "Unassigned"}</strong></div>
            <div><span>Reviewer</span><strong>{item.reviewerName ?? "Not assigned"}</strong></div>
            <div><span>Workflow state</span><strong>{titleCase(item.status)}</strong></div>
          </div>
          {item.originalStatutoryDueDate && (
            <section className="work-360-extension">
              <p className="eyebrow">DUE DATE EXTENDED</p>
              <strong>{formatDate(item.originalStatutoryDueDate)} → {formatDate(item.statutoryDueDate)}</strong>
              <small>
                {extension ? extension.authority : "Recorded against this period"}
                {extension?.note ? ` · ${extension.note}` : ""}
              </small>
            </section>
          )}
          {escalations.length > 0 && (
            <section className="work-360-blocker">
              <p className="eyebrow">ESCALATED</p>
              <h2>Reached rung {escalations[0]!.rung}</h2>
              <div className="work-360-escalations">
                {escalations.map((escalation) => (
                  <div className={`work-360-escalation${escalation.notifiedCount === 0 ? " is-overtaken" : ""}`} key={escalation.id}>
                    <strong>Rung {escalation.rung} · {escalation.reason}</strong>
                    <small>{formatDate(escalation.firedOn)} · {escalation.recipientSummary}</small>
                  </div>
                ))}
              </div>
            </section>
          )}
          <section className="work-360-blocker"><p className="eyebrow">HANDOVER NOTE</p><h2>{item.blockerNote || "No note"}</h2><span>Context for whoever picks this up. What the work waits on is recorded above.</span></section>
        </article>
        <FilingAcknowledgements
          acknowledgements={acknowledgements}
          canRecord={canWrite}
          defaultFilingType={workServiceLabel(item.serviceKey).toUpperCase()}
          defaultPeriodKey={item.periodKey}
          legalEntityId={item.legalEntityId}
          todayKey={indiaDateKey()}
          workItemId={workItemId}
        />

        <aside className="work-360-aside surface-card"><p className="eyebrow">CONTROL SUMMARY</p><dl><div><dt>Client</dt><dd>{item.clientName}</dd></div><div><dt>Service</dt><dd>{workServiceLabel(item.serviceKey)}</dd></div><div><dt>Period</dt><dd>{item.periodKey}</dd></div><div><dt>Status</dt><dd>{titleCase(item.status)}</dd></div></dl>{completed && <p className="work-complete-note">This obligation is complete and excluded from active attention queues.</p>}</aside>
      </section>
    </main>
  );
}
