"use client";

import { completeWorkAction } from "./actions";

export default function CompleteWorkForm({ workItemId }: { workItemId: string }) {
  return (
    <form action={completeWorkAction} onSubmit={(event) => { if (!window.confirm("Mark this work item complete? Progress will become 100% and blockers will be cleared.")) event.preventDefault(); }}>
      <input name="workItemId" type="hidden" value={workItemId} />
      <button className="success-button" type="submit">Mark complete</button>
    </form>
  );
}
