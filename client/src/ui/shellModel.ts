/** Pure helpers for the app shell: Demo-account selector reconciliation and labels, and runId tracking. */
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

/** One entry of the Demo account selector: `id` is the option value, `label` its visible text. */
export type AccountOption = { id: string; label: string };

/** Between an employee's name and the employer's name: "Jordan Lee · Titan Foods". */
export const EMPLOYER_SEPARATOR = ' · ';

/**
 * The employee options of the Demo account selector: "<employee name> · <employer name>", in the order of
 * `GET /api/v2/employees` (so the story's employees stay first; DECISIONS pass 59). The employer is looked up
 * by `employee.businessId` in the `GET /api/v2/businesses` list. The label is the name alone while that list
 * is not loaded (`businesses` undefined), or when the employee has no employer in it or the employer has no name.
 */
export function employeeOptions(
  employees: readonly { id: string; name: string; businessId?: string }[],
  businesses: readonly { id: string; name: string }[] | undefined,
): AccountOption[] {
  const employerName = new Map((businesses ?? []).map((b) => [b.id, b.name]));
  return employees.map((e) => {
    const employer = e.businessId === undefined ? '' : (employerName.get(e.businessId) ?? '').trim();
    return { id: e.id, label: employer ? `${e.name}${EMPLOYER_SEPARATOR}${employer}` : e.name };
  });
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
/** The one dataset the app shows: NYC since the MVP II cutover (#548). */
export const ENV_DATASET: EnvDataset = 'nyc';
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

export const HOME_PATH = '/';
export const HELP_PAGE_PATH = '/help';
export const SIMULATOR_PAGE_PATH = '/simulator';
export const businessPath = (id: string) => `/business/${encodeURIComponent(id)}`;
export const employeePath = (id: string) => `/employee/${encodeURIComponent(id)}`;

/** True when the path is the Help page (a trailing slash counts, as in the router). */
export function isHelpPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, '') === HELP_PAGE_PATH;
}

/**
 * The old MVP II preview prefix. Since the cutover every `/nyc/...` path redirects to the same path
 * without it (DECISIONS pass 57), keeping the query string and hash.
 */
export const LEGACY_PREVIEW_PREFIX = '/nyc';

/** True on /nyc and any /nyc/... path. */
export function isLegacyPreviewPath(pathname: string): boolean {
  return /^\/nyc(?:\/|$)/.test(pathname);
}

/** Where a /nyc/... path now lives: `/nyc` → `/`, `/nyc/employee/E` → `/employee/E`. null for other paths. */
export function cutoverPath(pathname: string): string | null {
  if (!isLegacyPreviewPath(pathname)) return null;
  const rest = pathname.slice(LEGACY_PREVIEW_PREFIX.length);
  return rest === '' || rest === '/' ? HOME_PATH : rest;
}

/**
 * Picks the stored account if it is in the list, else the first one (the rule of `resolveIdentity`,
 * per list, so one list can be ready while the other is still loading). undefined = no list or empty.
 */
export function pickAccount(storedId: string | undefined, ids: readonly string[] | undefined): string | undefined {
  if (!ids) return undefined;
  return ids.find((id) => id === storedId) ?? ids[0];
}

/** Header, homepage and Guided demo links. A link whose list is not loaded (or answered 503) is pending (null). */
export function workspaceHrefs(businessId: string | undefined, employeeId: string | undefined): Record<Destination, string | null> {
  return {
    business: businessId ? businessPath(businessId) : null,
    employee: employeeId ? employeePath(employeeId) : null,
    simulator: SIMULATOR_PAGE_PATH,
  };
}

/** Pages that use the full window width instead of the 960 px column. */
export function isFullWidthPath(pathname: string): boolean {
  return /^\/simulator\/?$/.test(pathname);
}
