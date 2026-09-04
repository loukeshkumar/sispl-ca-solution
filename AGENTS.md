# Codex project instructions

- Do not invoke or apply Superpowers skills or workflows in this repository unless the user explicitly requests one.
- Do not use subagent-driven development or repeated review loops unless the user explicitly requests delegation.
- For normal development work, implement directly and use one consolidated validation pass.

## The manual ships with the change

`app/manual/` is the operating manual, served inside the product at `/manual` and open to every signed-in role. It is not notes kept beside the code: it is the page someone opens to learn how to do the work, so a workflow the manual does not describe is a workflow nobody outside this team can follow.

Update the manual **in the same change** that:

- adds a module, workspace, sidebar destination, or route with a page
- changes the states or the order of a workflow — the attendance month, a payroll run, an invoice, a procedure, a review round, a timesheet period
- adds, removes, or renames a permission, or moves a workspace behind a different one
- changes a limit the manual states — upload rules, separation of duties, entitlement, what a role can see, what the product refuses to do
- changes a setup step, an npm script, an environment variable, or a scheduled job

How to update it:

1. Write or edit the chapter in `app/manual/chapters-*.tsx`.
2. A new chapter also needs its entry in `lib/manual/contents.ts`. The contents and the chapters are one list, and `tests/manual-unit.test.ts` asserts they agree.
3. Call a destination exactly what the sidebar calls it. A reader searching for the words on their own screen has to find them.
4. A pipeline shows **states**, not verbs; the prose beside it describes the transitions.
5. Never transcribe a permission table. Render it from `permissionDefinitions` and `lib/dashboard/navigation`, as `chapters-running.tsx` does, so it cannot describe a rule the server no longer enforces.
6. If the change narrows or widens what the product does, the boundaries list in chapter 1 is part of the change too.

`tests/manual-coverage-unit.test.ts` fails when a sidebar destination, a routed page, or a state in a typed workflow union is undocumented. That guard catches an absent chapter; it cannot catch a chapter whose prose has quietly gone stale. Keeping the prose true is the author's job, not the test's.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
