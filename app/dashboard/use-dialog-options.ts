"use client";

import { unstable_rethrow } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type DialogOptionsState<T> = { data: T | null; loading: boolean; failed: boolean };

/**
 * Loads a dialog's dropdown data the first time it opens, not on every page load.
 *
 * Form options — client lists, member lists, open work items — are only needed
 * once someone actually opens the form. Fetching them eagerly would add queries
 * to every dashboard render for a dialog most visits never open.
 *
 * The result is cached for the life of the component, so reopening is instant.
 * A failure is surfaced rather than swallowed: the dialog offers a retry instead
 * of an empty dropdown that would read as "no clients exist".
 *
 * Staleness is handled with a request ticket rather than a per-effect cancelled
 * flag. Under StrictMode the effect is invoked twice: a flag set by the first
 * cleanup would silence the in-flight response, while an `inFlight` guard would
 * make the second invocation bail out because the promise had not settled yet —
 * between them, no state was ever set and the dialog rendered empty forever.
 * Scheduling the fetch a tick later means the discarded first invocation is
 * cancelled before it starts, and only the newest ticket may write state.
 *
 * Loaders begin with `requirePermission`, which redirects by throwing. Catching
 * that would turn "your session expired, sign in again" into a generic "the
 * form could not be loaded", stranding the reader in a dialog that can never
 * succeed — so framework control-flow errors are rethrown untouched.
 */
export function useDialogOptions<T>(
  open: boolean,
  load: () => Promise<T>,
): DialogOptionsState<T> & { retry: () => void } {
  const [state, setState] = useState<DialogOptionsState<T>>({ data: null, loading: false, failed: false });
  const latest = useRef(0);
  const loaded = useRef(false);

  useEffect(() => {
    if (!open || loaded.current) return;
    const ticket = (latest.current += 1);
    // Every write happens inside this callback, so the effect never sets state
    // synchronously and cannot cascade a render.
    const timer = setTimeout(() => {
      setState({ data: null, loading: true, failed: false });
      load()
        .then((data) => {
          if (latest.current !== ticket) return;
          loaded.current = true;
          setState({ data, loading: false, failed: false });
        })
        .catch((error: unknown) => {
          // A redirect or notFound must reach the router, not this dialog.
          unstable_rethrow(error);
          console.error("Dialog options failed to load.", { errorType: error instanceof Error ? error.name : "UnknownError" });
          if (latest.current === ticket) setState({ data: null, loading: false, failed: true });
        });
    }, 0);
    return () => clearTimeout(timer);
    // `load` is a stable server-action reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return {
    ...state,
    retry: () => {
      loaded.current = false;
      const ticket = (latest.current += 1);
      setState({ data: null, loading: true, failed: false });
      load()
        .then((data) => {
          if (latest.current !== ticket) return;
          loaded.current = true;
          setState({ data, loading: false, failed: false });
        })
        .catch((error: unknown) => {
          unstable_rethrow(error);
          console.error("Dialog options failed to reload.", { errorType: error instanceof Error ? error.name : "UnknownError" });
          if (latest.current === ticket) setState({ data: null, loading: false, failed: true });
        });
    },
  };
}
