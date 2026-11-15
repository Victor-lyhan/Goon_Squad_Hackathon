/**
 * The simulator's selection lives in the URL (DECISIONS pass 8, 47):
 * `?package=<shipmentId>` opens the journey, `?employee=<id>` and `?business=<id>`
 * select in the network view. `&play=1` next to a package starts its journey once (#648, pass 63).
 * Pure functions, no window reads.
 */

export type SimSelectionKind = 'package' | 'employee' | 'business';
export type SimSelection = { kind: SimSelectionKind; id: string } | null;
export type SimMode = 'journey' | 'network';

/** Keys in precedence order: the first one with a usable value wins. */
export const SELECTION_KEYS: readonly SimSelectionKind[] = ['package', 'employee', 'business'];

/** One usable value for `key`, or null when it is missing, blank, or given twice with different values. */
function singleValue(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key).filter((v) => v.trim() !== '');
  if (values.length === 0) return null;
  // `?package=a&package=b` is ambiguous: ignore the key rather than guess. Exact duplicates collapse.
  return values.every((v) => v === values[0]) ? values[0] : null;
}

// ---------- `play=1` (#648) ----------

/** The key a link adds to start the journey: `/simulator?package=<id>&play=1`. */
export const PLAY_KEY = 'play';

/** True when the query string asks to start playing: `play=1` (any other value asks nothing). */
export function wantsAutoPlay(search: string): boolean {
  return new URLSearchParams(search).getAll(PLAY_KEY).includes('1');
}

/** True when the `play` key is in the query string at all, whatever its value. */
export function hasAutoPlayKey(search: string): boolean {
  return new URLSearchParams(search).has(PLAY_KEY);
}

/**
 * The query string without the `play` key, every other key kept in its order: '' when nothing is
 * left, otherwise a string starting with '?'. The page replaces the URL with it once Play was
 * asked for, so a reload, Back or the next selection does not start a journey again.
 */
export function withoutAutoPlay(search: string): string {
  const next = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(search)) {
    if (key !== PLAY_KEY) next.append(key, value);
  }
  const qs = next.toString();
  return qs ? `?${qs}` : '';
}

// ---------- Selection ----------

/** Reads the selection from a query string (with or without the leading `?`). */
export function parseSimUrl(search: string): { selection: SimSelection; mode: SimMode } {
  const params = new URLSearchParams(search);
  for (const kind of SELECTION_KEYS) {
    const id = singleValue(params, kind);
    if (id !== null) return { selection: { kind, id }, mode: kind === 'package' ? 'journey' : 'network' };
  }
  return { selection: null, mode: 'network' };
}

/**
 * The canonical query string for a selection: the selection key first, then every
 * other key of `current` in its original order (selection keys from `current` are dropped).
 * Returns '' when nothing is left, otherwise a string starting with '?'.
 */
export function simUrlFor(selection: SimSelection, current = ''): string {
  const next = new URLSearchParams();
  if (selection && selection.id.trim() !== '') next.append(selection.kind, selection.id);
  for (const [key, value] of new URLSearchParams(current)) {
    if (!(SELECTION_KEYS as readonly string[]).includes(key)) next.append(key, value);
  }
  const qs = next.toString();
  return qs ? `?${qs}` : '';
}

export type SimIds = {
  shipmentIds: Iterable<string>;
  employeeIds: Iterable<string>;
  businessIds: Iterable<string>;
};

export type StaleSelection = { stale: true; kind: SimSelectionKind; id: string };
export type ResolvedSelection = SimSelection | StaleSelection;

function contains(ids: Iterable<string>, id: string): boolean {
  if (ids instanceof Set) return ids.has(id);
  for (const x of ids) if (x === id) return true;
  return false;
}

/**
 * Checks the selection against the current run. An unknown ID (a new run on the server,
 * or an old link) becomes `{ stale: true }` so the page shows a message with
 * "Back to network" instead of an empty map (DECISIONS pass 9). Call it once the run has loaded.
 */
export function resolveSelection(selection: SimSelection, ids: SimIds): ResolvedSelection {
  if (!selection) return null;
  const pool = selection.kind === 'package' ? ids.shipmentIds : selection.kind === 'employee' ? ids.employeeIds : ids.businessIds;
  return contains(pool, selection.id) ? selection : { stale: true, kind: selection.kind, id: selection.id };
}

export function isStale(resolved: ResolvedSelection): resolved is StaleSelection {
  return resolved !== null && 'stale' in resolved;
}

const KIND_NOUN: Record<SimSelectionKind, string> = { package: 'package', employee: 'employee', business: 'business' };

/** "That package isn't in this run.", and the same for an employee or a business (#894). */
export function staleMessage(kind: SimSelectionKind): string {
  return `That ${KIND_NOUN[kind]} isn't in this run.`;
}

export const BACK_TO_NETWORK = 'Back to network';
