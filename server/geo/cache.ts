// The travel cache on disk: `matrix.json` (places + raw Google seconds and meters per ordered pair) and
// `polylines.json` (encoded route lines), in the formats of shared/v2/types.ts. Every travel provider reads
// this one format. Nothing here estimates a time or a distance, and nothing here knows about a key.
import fs from 'node:fs';
import path from 'node:path';
import type { PolylinesFile, TravelMatrixFile } from '../../shared/v2/types';

export const MATRIX_FILE = 'matrix.json';
export const POLYLINES_FILE = 'polylines.json';
export const TRAVEL_SCHEMA_VERSION = 1;

export interface TravelFiles {
  matrix: TravelMatrixFile;
  polylines: PolylinesFile;
}

/** A cache file that is unreadable, has the wrong `schemaVersion` or shape, or could not be written. */
export class TravelCacheError extends Error {
  /** The file (or directory) the problem is in. */
  readonly file: string;
  constructor(file: string, problem: string, options?: { cause?: unknown }) {
    super(`Travel cache ${file}: ${problem}`, options);
    this.name = 'TravelCacheError';
    this.file = file;
  }
}

export function emptyTravelFiles(): TravelFiles {
  return {
    matrix: { schemaVersion: TRAVEL_SCHEMA_VERSION, places: {}, pairs: {} },
    polylines: { schemaVersion: TRAVEL_SCHEMA_VERSION, polylines: {} },
  };
}

/**
 * Google seconds -> whole minutes, rounded UP (61 s = 2 min, 60 s = 1 min, 0 s = 0 min).
 * The only place this rounding lives; every provider goes through it.
 */
export function minutesFromSeconds(seconds: number): number {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError(`A travel duration must be a non-negative number of seconds, got ${String(seconds)}`);
  }
  return Math.ceil(seconds / 60);
}

/** Both files of `a` and `b` in one new object. Where both have the same place, pair or polyline, `b` wins. Inputs are not changed. */
export function mergeTravelFiles(a: TravelFiles, b: TravelFiles): TravelFiles {
  const out = emptyTravelFiles();
  for (const files of [a, b]) {
    for (const [id, place] of Object.entries(files.matrix.places)) out.matrix.places[id] = { ...place };
    for (const [key, pair] of Object.entries(files.matrix.pairs)) out.matrix.pairs[key] = { ...pair };
    for (const [key, encoded] of Object.entries(files.polylines.polylines)) out.polylines.polylines[key] = encoded;
  }
  return out;
}

// ---------- shape checks (used for reading and before writing) ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** `"<from>|<to>"` with both sides present. */
function isPairKey(key: string): boolean {
  const cut = key.indexOf('|');
  return cut > 0 && cut < key.length - 1;
}

function sortedKeys(record: Record<string, unknown>): string[] {
  return Object.keys(record).sort(); // code-unit order: the same on every machine
}

function checkVersion(file: string, value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new TravelCacheError(file, 'expected a JSON object');
  if (value.schemaVersion !== TRAVEL_SCHEMA_VERSION) {
    throw new TravelCacheError(
      file,
      `schemaVersion is ${JSON.stringify(value.schemaVersion) ?? 'missing'}, expected ${TRAVEL_SCHEMA_VERSION}. Regenerate it with \`npm run fetch:routes\`.`,
    );
  }
}

/** Checks a matrix file and returns a clean copy with sorted keys and only the known fields. */
function checkedMatrix(file: string, value: unknown): TravelMatrixFile {
  checkVersion(file, value);
  if (!isRecord(value.places)) throw new TravelCacheError(file, '`places` must be an object');
  if (!isRecord(value.pairs)) throw new TravelCacheError(file, '`pairs` must be an object');

  const places: TravelMatrixFile['places'] = {};
  for (const id of sortedKeys(value.places)) {
    const place = value.places[id];
    if (id === '' || !isRecord(place) || !isCoordinate(place.lat, 90) || !isCoordinate(place.lng, 180)) {
      throw new TravelCacheError(file, `place ${JSON.stringify(id)} needs a numeric lat and lng`);
    }
    if (place.formattedAddress !== undefined && typeof place.formattedAddress !== 'string') {
      throw new TravelCacheError(file, `place ${JSON.stringify(id)} has a formattedAddress that is not a string`);
    }
    places[id] = { lat: place.lat, lng: place.lng };
    if (place.formattedAddress !== undefined) places[id].formattedAddress = place.formattedAddress;
  }

  const pairs: TravelMatrixFile['pairs'] = {};
  for (const key of sortedKeys(value.pairs)) {
    const pair = value.pairs[key];
    if (!isPairKey(key)) throw new TravelCacheError(file, `pair key ${JSON.stringify(key)} is not "<from>|<to>"`);
    if (!isRecord(pair) || !isAmount(pair.durationS) || !isAmount(pair.distanceM)) {
      throw new TravelCacheError(file, `pair ${JSON.stringify(key)} needs a non-negative durationS and distanceM`);
    }
    pairs[key] = { durationS: pair.durationS, distanceM: pair.distanceM };
  }
  return { schemaVersion: TRAVEL_SCHEMA_VERSION, places, pairs };
}

function isCoordinate(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}

/** Checks a polylines file and returns a clean copy with sorted keys. */
function checkedPolylines(file: string, value: unknown): PolylinesFile {
  checkVersion(file, value);
  if (!isRecord(value.polylines)) throw new TravelCacheError(file, '`polylines` must be an object');
  const polylines: PolylinesFile['polylines'] = {};
  for (const key of sortedKeys(value.polylines)) {
    const encoded = value.polylines[key];
    if (!isPairKey(key)) throw new TravelCacheError(file, `polyline key ${JSON.stringify(key)} is not "<from>|<to>"`);
    if (typeof encoded !== 'string' || encoded === '') {
      throw new TravelCacheError(file, `polyline ${JSON.stringify(key)} must be a non-empty string`);
    }
    polylines[key] = encoded;
  }
  return { schemaVersion: TRAVEL_SCHEMA_VERSION, polylines };
}

// ---------- reading ----------

/** The file's text, or null when the file (or its directory) does not exist. */
function readTextIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw new TravelCacheError(filePath, `could not be read (${code ?? 'unknown error'})`, { cause: err });
  }
}

function parseJson(filePath: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new TravelCacheError(filePath, 'is not valid JSON');
  }
}

/**
 * Reads `matrix.json` and `polylines.json` from `dir`.
 * - no `matrix.json` (or no directory): `null`, there is no travel data yet;
 * - no `polylines.json`: an empty polylines file;
 * - a file that is not JSON, or has the wrong `schemaVersion` or shape: throws TravelCacheError naming the file.
 */
export function readTravelFiles(dir: string): TravelFiles | null {
  const matrixPath = path.join(dir, MATRIX_FILE);
  const matrixText = readTextIfExists(matrixPath);
  if (matrixText === null) return null;
  const matrix = checkedMatrix(matrixPath, parseJson(matrixPath, matrixText));

  const polylinesPath = path.join(dir, POLYLINES_FILE);
  const polylinesText = readTextIfExists(polylinesPath);
  const polylines =
    polylinesText === null ? emptyTravelFiles().polylines : checkedPolylines(polylinesPath, parseJson(polylinesPath, polylinesText));
  return { matrix, polylines };
}

// ---------- writing ----------

/** The exact bytes written for each file: sorted keys, 2-space JSON, one trailing newline. */
export function serializeTravelFiles(files: TravelFiles): { matrix: string; polylines: string } {
  return {
    matrix: `${JSON.stringify(checkedMatrix(MATRIX_FILE, files.matrix), null, 2)}\n`,
    polylines: `${JSON.stringify(checkedPolylines(POLYLINES_FILE, files.polylines), null, 2)}\n`,
  };
}

/**
 * Writes both files into `dir` (created if needed).
 * - The data is checked first, so bad data throws before the disk is touched.
 * - Each file goes to a temp file and is renamed over the target, so a reader never sees half a file.
 *   `matrix.json` is replaced last, only after everything else worked.
 * - A file whose bytes would not change is left alone, so re-running gives no diff.
 * On failure the temp files are removed and a TravelCacheError is thrown.
 */
export function writeTravelFiles(dir: string, files: TravelFiles): void {
  const text = serializeTravelFiles(files);
  const targets = [
    { filePath: path.join(dir, POLYLINES_FILE), text: text.polylines },
    { filePath: path.join(dir, MATRIX_FILE), text: text.matrix },
  ];
  const temps: { tmp: string; filePath: string }[] = [];
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const { filePath, text: content } of targets) {
      if (unchanged(filePath, content)) continue;
      const tmp = `${filePath}.${process.pid}.tmp`;
      temps.push({ tmp, filePath });
      fs.writeFileSync(tmp, content);
    }
    for (const { tmp, filePath } of temps) fs.renameSync(tmp, filePath);
  } catch (err) {
    for (const { tmp } of temps) fs.rmSync(tmp, { force: true });
    const code = (err as NodeJS.ErrnoException).code;
    throw new TravelCacheError(dir, `could not be written (${code ?? (err instanceof Error ? err.message : 'unknown error')})`, { cause: err });
  }
}

function unchanged(filePath: string, content: string): boolean {
  try {
    return fs.readFileSync(filePath, 'utf8') === content;
  } catch {
    return false;
  }
}
