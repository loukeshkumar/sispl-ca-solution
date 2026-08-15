import Link from "next/link";

export function getDashboardErrorViewModel(_error: unknown) {
  void _error;
  return {
    eyebrow: "LOCAL DATA SOURCE",
    title: "The practice database is unavailable",
    message: "SISPL is configured for PostgreSQL and will not substitute demonstration data.",
    guidance: "Confirm PostgreSQL is running, check .env.local, then run the local database check.",
  };
}

export default function DashboardError({ error }: { error: unknown }) {
  const viewModel = getDashboardErrorViewModel(error);
  return (
    <main className="database-error-shell">
      <section className="database-error-card" role="alert">
        <span>{viewModel.eyebrow}</span>
        <h1>{viewModel.title}</h1>
        <p>{viewModel.message}</p>
        <small>{viewModel.guidance}</small>
        <Link href="/">Retry connection</Link>
      </section>
    </main>
  );
}
