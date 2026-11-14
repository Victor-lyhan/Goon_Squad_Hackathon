/** Pure helpers for the app shell: Demo-account selector reconciliation and runId tracking. */
export const RUN_POLL_MS = 3000;

export type Selection = {
  /** The id the selector should show: the URL id if it exists, else the first valid id ('' if the list is empty). */
  id: string;
  /** True when the URL id is not in the current city. */
  stale: boolean;
};

export function reconcileSelection(urlId: string | undefined, ids: readonly string[]): Selection {
  if (urlId !== undefined && ids.includes(urlId)) return { id: urlId, stale: false };
  return { id: ids[0] ?? '', stale: true };
}

export function staleNote(kind: 'business' | 'employee', fallbackName: string | null): string {
  const what = kind === 'business' ? 'business' : 'employee';
  return fallbackName
    ? `That ${what} isn't in the current city. Showing ${fallbackName} instead.`
    : `That ${what} isn't in the current city.`;
}

/** True when a polled runId differs from the last one seen (the first sighting is not a change). */
export function runChanged(prev: string | null, next: string | null | undefined): boolean {
  return prev !== null && !!next && prev !== next;
}
