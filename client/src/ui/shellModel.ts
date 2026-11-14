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

/** Header environment indicator. The label must describe the data on screen (DECISIONS pass 44). */
export const ENV_LABELS = {
  synthetic: 'Synthetic city · simulated deliveries',
  nyc: 'Real NYC locations · simulated deliveries',
} as const;
export type EnvDataset = keyof typeof ENV_LABELS;
/** The one dataset the app shows today. Switch to 'nyc' at the MVP II cutover. */
export const ENV_DATASET: EnvDataset = 'synthetic';
export const ENV_INDICATOR_TEXT: string = ENV_LABELS[ENV_DATASET];

/** The three primary destinations, in header order. */
export type Destination = 'business' | 'employee' | 'simulator';
export const DESTINATIONS: readonly { key: Destination; label: string }[] = [
  { key: 'business', label: 'Business' },
  { key: 'employee', label: 'Employee' },
  { key: 'simulator', label: 'Simulator' },
];

/** Which destination the current path belongs to (any id counts), or null. */
export function activeDestination(pathname: string): Destination | null {
  const m = /^\/(business|employee|simulator)(?:\/|$)/.exec(pathname);
  return m ? (m[1] as Destination) : null;
}

/** MVP II preview paths (DECISIONS pass 46, pass 52): the v2 pages live under /nyc/… until the cutover. */
export const PREVIEW_PREFIX = '/nyc';
export const PREVIEW_SIMULATOR_PATH = '/nyc/simulator';
export const previewEmployeePath = (id: string) => `/nyc/employee/${encodeURIComponent(id)}`;

/** True on any /nyc or /nyc/… path. */
export function isPreviewPath(pathname: string): boolean {
  return /^\/nyc(?:\/|$)/.test(pathname);
}

/** The indicator for the data on screen: NYC on the preview, synthetic elsewhere (until the cutover). */
export function envIndicatorFor(pathname: string): string {
  return isPreviewPath(pathname) ? ENV_LABELS.nyc : ENV_INDICATOR_TEXT;
}

/** Which destination a preview path belongs to (/nyc/simulator, /nyc/employee/<id>), or null. */
export function previewDestination(pathname: string): Destination | null {
  const m = /^\/nyc\/(business|employee|simulator)(?:\/|$)/.exec(pathname);
  return m ? (m[1] as Destination) : null;
}

/** Header links on the preview. Business has no preview page yet, so it is pending (null). */
export function previewHrefs(firstEmployeeId: string | undefined): Record<Destination, string | null> {
  return {
    business: null,
    employee: firstEmployeeId ? previewEmployeePath(firstEmployeeId) : null,
    simulator: PREVIEW_SIMULATOR_PATH,
  };
}

/** Pages that use the full window width instead of the 960 px column. */
export function isFullWidthPath(pathname: string): boolean {
  return /^\/nyc\/simulator\/?$/.test(pathname);
}
