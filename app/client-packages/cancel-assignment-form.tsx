import { cancelClientPackageAction } from "../packages/actions";

export function CancelAssignmentForm({ assignmentId, error }: { assignmentId: string; error?: string }) {
  return <form action={cancelClientPackageAction} className="cancel-package-form surface-card">
    <div><p className="eyebrow">AGREEMENT CONTROL</p><h2>Cancel assignment</h2><span>Cancellation preserves the complete commercial and service snapshot.</span></div>
    <input name="assignmentId" type="hidden" value={assignmentId} />
    <label><span>Cancellation reason</span><input maxLength={300} minLength={3} name="reason" placeholder="Why is this agreement ending?" required /></label>
    {error && <p className="package-form-banner" role="alert">The assignment could not be cancelled. Review its current status and try again.</p>}
    <button className="danger-button" type="submit">Cancel package assignment</button>
  </form>;
}
