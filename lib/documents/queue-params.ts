export type DocumentScope = "chase" | "open" | "received" | "cancelled" | "all";
export type DocumentLayout = "list" | "client";

export type DocumentParams = { layout: DocumentLayout; q: string; scope: DocumentScope };

const SCOPES: readonly DocumentScope[] = ["chase", "open", "received", "cancelled", "all"];
const LAYOUTS: readonly DocumentLayout[] = ["list", "client"];

/** Chasing is the job on this page, so it opens on what is actually late. */
export const DEFAULT_DOCUMENT_PARAMS: DocumentParams = { layout: "list", q: "", scope: "chase" };

function first(raw: Record<string, string | string[] | undefined>, key: string) {
  const value = raw[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export function parseDocumentParams(raw: Record<string, string | string[] | undefined>): DocumentParams {
  const layout = first(raw, "layout");
  const scope = first(raw, "scope");
  return {
    layout: LAYOUTS.includes(layout as DocumentLayout) ? (layout as DocumentLayout) : DEFAULT_DOCUMENT_PARAMS.layout,
    q: first(raw, "q").slice(0, 120),
    scope: SCOPES.includes(scope as DocumentScope) ? (scope as DocumentScope) : DEFAULT_DOCUMENT_PARAMS.scope,
  };
}

export function documentsHref(params: Partial<DocumentParams>): string {
  const search = new URLSearchParams({ workspace: "documents" });
  const merged = { ...DEFAULT_DOCUMENT_PARAMS, ...params };
  if (merged.scope !== DEFAULT_DOCUMENT_PARAMS.scope) search.set("scope", merged.scope);
  if (merged.layout !== DEFAULT_DOCUMENT_PARAMS.layout) search.set("layout", merged.layout);
  if (merged.q) search.set("q", merged.q);
  return `/?${search.toString()}`;
}
