/**
 * Loads a supporting panel without letting it take down the page it decorates.
 *
 * Panels added onto an existing workspace — a checklist, a suggestion, a related
 * register — are enhancements. If one fails, the primary workflow must still be
 * usable. Only the page's own primary data is allowed to throw.
 *
 * The failure is logged with the error type only, never the message, so a
 * database error cannot leak a query or a parameter into the logs.
 */
export async function loadOptionalPanel<T>(panel: string, load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch (error) {
    console.error("Optional panel failed to load.", {
      panel,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return fallback;
  }
}
