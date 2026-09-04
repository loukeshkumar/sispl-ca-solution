import type { ReactNode } from "react";

import { manualChapter } from "../../lib/manual/contents";

/**
 * The manual's building blocks.
 *
 * Prose is the least of it: what makes a procedure readable is that a step, a
 * limit and a state machine each look like themselves. Writing those as markup
 * in every chapter is how three chapters end up with three different idea of
 * what a warning looks like, so they live here once.
 */

/** One numbered chapter. Number and title come from the contents, never inline. */
export function Chapter({ children, id }: { children: ReactNode; id: string }) {
  const chapter = manualChapter(id);
  return (
    <section className="manual-chapter" id={id}>
      <header className="manual-chapter-head">
        <span className="manual-chapter-number">{chapter.number}</span>
        <h2>{chapter.title}</h2>
        <p>{chapter.summary}</p>
      </header>
      {children}
    </section>
  );
}

/** An ordered procedure. Numbering here is the sequence, not decoration. */
export function Steps({ children }: { children: ReactNode }) {
  return <ol className="manual-steps">{children}</ol>;
}

/**
 * A callout, in one of three registers:
 * `limit` for a boundary the product enforces, `rule` for how something
 * behaves, `care` for what goes wrong if it is done in the wrong order.
 */
export function Note({ children, tag, tone = "rule" }: { children: ReactNode; tag: string; tone?: "limit" | "rule" | "care" }) {
  return (
    <aside className={`manual-note is-${tone}`}>
      <p className="manual-note-tag">{tag}</p>
      {children}
    </aside>
  );
}

/** A state machine, read left to right. `mark` colours the state that matters. */
export function Pipeline({ states }: { states: Array<{ label: string; mark?: "locked" | "done"; step: string }> }) {
  return (
    <ol className="manual-pipeline">
      {states.map((state) => (
        <li className={state.mark ? `is-${state.mark}` : undefined} key={state.label}>
          <span className="manual-pipeline-step">{state.step}</span>
          <b>{state.label}</b>
        </li>
      ))}
    </ol>
  );
}

/** Form fields as a term list, so a field name is never mistaken for prose. */
export function Fields({ rows }: { rows: Array<{ note: ReactNode; term: string }> }) {
  return (
    <dl className="manual-fields">
      {rows.map((row) => (
        <div key={row.term}>
          <dt>{row.term}</dt>
          <dd>{row.note}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Tables scroll inside their own frame, so a wide one never moves the page. */
export function TableFrame({ children }: { children: ReactNode }) {
  return <div className="manual-table-frame">{children}</div>;
}

/** A path or route, set apart from the sentence carrying it. */
export function Path({ children }: { children: ReactNode }) {
  return <code className="manual-path">{children}</code>;
}

/** A terminal block. Lines beginning `#` read as comment, not command. */
export function Terminal({ lines }: { lines: string[] }) {
  return (
    <pre className="manual-terminal">
      <code>
        {lines.map((line, index) => (
          <span className={line.startsWith("#") ? "manual-terminal-comment" : undefined} key={`${line}-${index}`}>
            {line}
            {index < lines.length - 1 ? "\n" : ""}
          </span>
        ))}
      </code>
    </pre>
  );
}
