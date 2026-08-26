"use client";

import { useState } from "react";

import type { ClientEditorData } from "../../../lib/clients/repository";
import ClientDialog from "../../dashboard/client-dialog";

/** Editing lives on Client 360, where the full record is already loaded. */
export default function EditClientButton({ client }: { client: ClientEditorData }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="secondary-button" onClick={() => setOpen(true)} type="button">Edit client</button>
      <ClientDialog initial={client} onClose={() => setOpen(false)} open={open} />
    </>
  );
}
