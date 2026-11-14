// Server key loading for the geo layer (SPEC "MVP II" rule 2).
// `loadDotEnv` copies KEY=value lines of the repo-root `.env` into the environment; `serverKey` reads the Google
// server key from it. This file logs nothing and never puts a value into an error or a return value:
// callers only ever get variable names back.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_KEY_NAME = 'GOOGLE_MAPS_SERVER_KEY';

/** `<repo root>/.env`, resolved from this file so it does not depend on the working directory. */
export const DEFAULT_ENV_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');

type Env = Record<string, string | undefined>;

const LINE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/** The value part of a `KEY=value` line: surrounding quotes removed, or an unquoted value cut at ` #`. */
function parseValue(raw: string): string {
  const text = raw.trim();
  const quote = text[0];
  if (quote === '"' || quote === "'") {
    const end = text.indexOf(quote, 1);
    if (end > 0) return text.slice(1, end);
  }
  return text.replace(/\s+#.*$/, '').trim();
}

/**
 * Loads `KEY=value` lines (blank lines, `#` comments and an `export ` prefix are fine) into `env`.
 * A variable that is already set, even to an empty string, is never overridden. A missing or unreadable file
 * loads nothing. Returns the names it set, never their values.
 */
export function loadDotEnv(filePath: string = DEFAULT_ENV_PATH, env: Env = process.env): string[] {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  const loaded: string[] = [];
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const match = LINE.exec(line.trim());
    if (!match) continue;
    const name = match[1];
    if (env[name] !== undefined) continue;
    env[name] = parseValue(match[2]);
    loaded.push(name);
  }
  return loaded;
}

/** The trimmed GOOGLE_MAPS_SERVER_KEY, or null when it is unset or blank. */
export function serverKey(env: Env = process.env): string | null {
  const value = env[SERVER_KEY_NAME];
  if (typeof value !== 'string') return null;
  const key = value.trim();
  return key === '' ? null : key;
}
