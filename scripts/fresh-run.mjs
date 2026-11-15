// Start fresh (#965): `npm run dev` runs this once, before the API and Vite start, so the app opens on the
// fresh run (the 24 story deliveries) and not on a saved run full of test requests.
//
//   node scripts/fresh-run.mjs
//
// It removes the saved run file the server would open and prints one line:
//   Fresh run: removed the saved run
//   Fresh run: nothing saved
// It always exits with 0, so the servers start after it either way. If the file is there and cannot be
// removed, the one line says so, with the file and the error code.
//
// Only the state file goes. Its sidecar (`state-v2.source.json`) and the runs the server set aside
// (`.stale-<n>`, `.bad-<n>`) stay where they are. `npm run dev:keep` and `npm start` do not run this.
// It runs once per `npm run dev`, not inside `tsx watch`, so a reload of the server keeps the run.
//
// Plain Node and no imports from the repo, so it runs before anything is compiled. For that reason the two
// rules below are written out again here. tests/api/fresh-run.test.ts holds them against the server's own:
//   - `.env` is read as `loadDotEnv` of server/geo/env.ts reads it. Only RELAY_STATE_PATH is taken from it;
//     nothing from `.env` is printed.
//   - the state file is found as `statePathFrom` of server/index.ts finds it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STATE_PATH_NAME = 'RELAY_STATE_PATH';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(repoRoot, '.env');
const defaultStatePath = path.join(repoRoot, 'data', 'state-v2.json');

const LINE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/** The value part of a `KEY=value` line: surrounding quotes removed, or an unquoted value cut at ` #`. */
function parseValue(raw) {
  const text = raw.trim();
  const quote = text[0];
  if (quote === '"' || quote === "'") {
    const end = text.indexOf(quote, 1);
    if (end > 0) return text.slice(1, end);
  }
  return text.replace(/\s+#.*$/, '').trim();
}

/**
 * RELAY_STATE_PATH as the server will see it. A variable that is set in the environment wins, even when it
 * is empty. Else the first such line of `.env` counts. A missing or unreadable `.env` gives nothing.
 */
function givenStatePath() {
  const fromEnvironment = process.env[STATE_PATH_NAME];
  if (fromEnvironment !== undefined) return fromEnvironment;
  let text;
  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch {
    return undefined;
  }
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const match = LINE.exec(line.trim());
    if (match && match[1] === STATE_PATH_NAME) return parseValue(match[2]);
  }
  return undefined;
}

/**
 * The state file of the next start: the given path when it is not blank, else `data/state-v2.json`. A
 * relative path counts from the working directory. A value that ends in a slash or names an existing folder
 * means `state-v2.json` in that folder.
 */
function statePath(given) {
  const value = given?.trim();
  if (!value) return defaultStatePath;
  const file = path.resolve(value);
  let folder = /[\\/]$/.test(value);
  try {
    folder ||= fs.statSync(file).isDirectory();
  } catch {
    // nothing there: nothing saved
  }
  return folder ? path.join(file, path.basename(defaultStatePath)) : file;
}

function freshRun() {
  const file = statePath(givenStatePath());
  try {
    fs.unlinkSync(file);
    return 'Fresh run: removed the saved run';
  } catch (e) {
    const code = e?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return 'Fresh run: nothing saved';
    return `Fresh run: could not remove the saved run ${file} (${code ?? 'unknown error'})`;
  }
}

let line;
try {
  line = freshRun();
} catch {
  line = 'Fresh run: could not remove the saved run';
}
console.log(line);
