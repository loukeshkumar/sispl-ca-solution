"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { toastMessageFor, toastToneFor } from "../../lib/ui/toast-messages";

export type ToastTone = "success" | "error" | "info";
type Toast = { id: number; message: string; tone: ToastTone };

type ToastContextValue = {
  dismiss: (id: number) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  success: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

/** Successes clear themselves; an error waits, because it usually needs a decision. */
const dismissAfter: Record<ToastTone, number> = { error: 9000, info: 6000, success: 5000 };

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((message: string, tone: ToastTone) => {
    const id = (nextId.current += 1);
    // Three is enough to see a burst without burying the workspace behind them.
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
    timers.current.set(id, setTimeout(() => dismiss(id), dismissAfter[tone]));
  }, [dismiss]);

  useEffect(() => {
    const pending = timers.current;
    return () => { for (const timer of pending.values()) clearTimeout(timer); };
  }, []);

  const value = useMemo<ToastContextValue>(() => ({
    dismiss,
    error: (message) => push(message, "error"),
    info: (message) => push(message, "info"),
    success: (message) => push(message, "success"),
  }), [dismiss, push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastRegion onDismiss={dismiss} toasts={toasts} />
    </ToastContext.Provider>
  );
}

/**
 * The live region is always present, empty or not: a region added to the page at
 * the same moment as its content is not reliably announced by screen readers.
 */
function ToastRegion({ onDismiss, toasts }: { onDismiss: (id: number) => void; toasts: Toast[] }) {
  return (
    <div aria-label="Notifications" className="toast-region" role="region">
      {toasts.map((toast) => (
        <output
          aria-live={toast.tone === "error" ? "assertive" : "polite"}
          className={`toast is-${toast.tone}`}
          key={toast.id}
        >
          <span>{toast.message}</span>
          <button aria-label="Dismiss notification" onClick={() => onDismiss(toast.id)} type="button">&times;</button>
        </output>
      ))}
    </div>
  );
}

/**
 * Confirms mutations that redirect instead of returning to a dialog. The key is
 * resolved against an allow-list and then stripped from the URL, so a refresh or
 * a shared link does not replay the confirmation.
 */
export function RouteToasts() {
  const parameters = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const lastHandled = useRef<string | null>(null);

  const key = parameters.get("toast");
  useEffect(() => {
    if (!key || lastHandled.current === key) return;
    lastHandled.current = key;
    const message = toastMessageFor(key);
    if (message) toast[toastToneFor(key)](message);
    const remaining = new URLSearchParams(parameters);
    remaining.delete("toast");
    const query = remaining.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [key, parameters, pathname, router, toast]);

  return null;
}
