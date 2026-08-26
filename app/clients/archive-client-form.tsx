"use client";

import { archiveClientAction } from "./actions";

export default function ArchiveClientForm({ clientId, clientName }: { clientId: string; clientName: string }) {
  return (
    <form
      action={archiveClientAction}
      onSubmit={(event) => {
        if (!window.confirm(`Archive ${clientName}? This is allowed only after every open work item and document request is resolved. Historical records will remain available.`)) event.preventDefault();
      }}
    >
      <input name="clientId" type="hidden" value={clientId} />
      <button className="danger-button" type="submit">Archive client</button>
    </form>
  );
}
