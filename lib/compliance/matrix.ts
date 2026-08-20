export type MatrixSource = {
  clientName: string;
  id: string;
  legalEntityId: string;
  periodKey: string;
  status: string;
};

export type MatrixCell = { id: string | null; periodKey: string; status: string | null };
export type MatrixRow = { cells: MatrixCell[]; clientName: string; legalEntityId: string };
export type Matrix = { periods: string[]; rows: MatrixRow[] };

/**
 * Clients down, periods across, for one service at a time. A matrix spanning
 * every service has no meaningful column axis: "August 2026" and "FY 2026-27"
 * are not the same kind of column.
 *
 * A cell with no work item is null rather than absent, so a hole in the grid
 * reads as "not raised" instead of silently collapsing the row.
 */
export function buildComplianceMatrix(rows: MatrixSource[], periodLimit = 6): Matrix {
  const periods = [...new Set(rows.map((row) => row.periodKey))].sort().slice(-periodLimit);
  const clients = new Map<string, string>();
  for (const row of rows) clients.set(row.legalEntityId, row.clientName);
  const byKey = new Map(rows.map((row) => [`${row.legalEntityId}::${row.periodKey}`, row]));
  return {
    periods,
    rows: [...clients.entries()]
      .sort((left, right) => left[1].localeCompare(right[1]))
      .map(([legalEntityId, clientName]) => ({
        cells: periods.map((periodKey) => {
          const found = byKey.get(`${legalEntityId}::${periodKey}`);
          return { id: found?.id ?? null, periodKey, status: found?.status ?? null };
        }),
        clientName,
        legalEntityId,
      })),
  };
}
