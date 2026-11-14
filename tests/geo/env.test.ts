// server/geo/env.ts against temp files with fake values only. The real .env is never read here.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ENV_PATH, SERVER_KEY_NAME, loadDotEnv, serverKey } from '../../server/geo/env';

const FAKE_KEY = 'FAKE-server-key-000';
const TEST_VAR = 'RELAY_ENV_TEST_ONLY_VAR';

function tempEnvFile(content: string): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'relay-env-')), '.env');
  fs.writeFileSync(file, content);
  return file;
}

afterEach(() => {
  delete process.env[TEST_VAR];
  vi.restoreAllMocks();
});

describe('loadDotEnv', () => {
  it('loads KEY=value lines from a temp .env and returns only the names', () => {
    const env: Record<string, string | undefined> = {};
    const file = tempEnvFile(`${SERVER_KEY_NAME}=${FAKE_KEY}\nVITE_GOOGLE_MAPS_BROWSER_KEY=FAKE-browser-key\n`);
    const loaded = loadDotEnv(file, env);
    expect(env[SERVER_KEY_NAME]).toBe(FAKE_KEY);
    expect(env.VITE_GOOGLE_MAPS_BROWSER_KEY).toBe('FAKE-browser-key');
    expect(loaded).toEqual([SERVER_KEY_NAME, 'VITE_GOOGLE_MAPS_BROWSER_KEY']);
    expect(serverKey(env)).toBe(FAKE_KEY);
  });

  it('writes into process.env by default', () => {
    const file = tempEnvFile(`${TEST_VAR}=from-file\n`);
    expect(loadDotEnv(file)).toEqual([TEST_VAR]);
    expect(process.env[TEST_VAR]).toBe('from-file');
  });

  it('never overrides a variable that is already set, even an empty one', () => {
    process.env[TEST_VAR] = 'from-shell';
    const file = tempEnvFile(`${TEST_VAR}=from-file\n`);
    expect(loadDotEnv(file)).toEqual([]);
    expect(process.env[TEST_VAR]).toBe('from-shell');

    const env: Record<string, string | undefined> = { [SERVER_KEY_NAME]: '' };
    expect(loadDotEnv(tempEnvFile(`${SERVER_KEY_NAME}=${FAKE_KEY}\n`), env)).toEqual([]);
    expect(env[SERVER_KEY_NAME]).toBe('');
  });

  it('does nothing when the file is missing or is not a file', () => {
    const env: Record<string, string | undefined> = {};
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-env-'));
    expect(loadDotEnv(path.join(dir, 'no-such.env'), env)).toEqual([]);
    expect(loadDotEnv(dir, env)).toEqual([]);
    expect(env).toEqual({});
  });

  it('reads comments, blank lines, quotes, "export", spaces and CRLF the usual way', () => {
    const env: Record<string, string | undefined> = {};
    const file = tempEnvFile(
      [
        '# a comment',
        '',
        'PLAIN=one',
        'export EXPORTED=two',
        'SPACED = three  ',
        'DOUBLE="four # kept"',
        "SINGLE='five'",
        'TRAILING=six # dropped',
        'HAS_EQUALS=a=b=c',
        'EMPTY=',
        'not a variable line',
        '1BAD=name',
      ].join('\r\n'),
    );
    loadDotEnv(file, env);
    expect(env).toEqual({
      PLAIN: 'one',
      EXPORTED: 'two',
      SPACED: 'three',
      DOUBLE: 'four # kept',
      SINGLE: 'five',
      TRAILING: 'six',
      HAS_EQUALS: 'a=b=c',
      EMPTY: '',
    });
  });

  it('the first of two lines for the same name wins', () => {
    const env: Record<string, string | undefined> = {};
    expect(loadDotEnv(tempEnvFile('TWICE=first\nTWICE=second\n'), env)).toEqual(['TWICE']);
    expect(env.TWICE).toBe('first');
  });

  it('prints nothing, so a value can never reach a log', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => {}));
    const env: Record<string, string | undefined> = {};
    const loaded = loadDotEnv(tempEnvFile(`${SERVER_KEY_NAME}=${FAKE_KEY}\n`), env);
    serverKey(env);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(loaded)).not.toContain(FAKE_KEY);
  });

  it('defaults to the .env at the repo root', () => {
    expect(DEFAULT_ENV_PATH).toBe(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env'));
  });
});

describe('serverKey', () => {
  it('returns the trimmed key', () => {
    expect(serverKey({ [SERVER_KEY_NAME]: `  ${FAKE_KEY}\n` })).toBe(FAKE_KEY);
  });

  it('returns null when the key is unset or blank', () => {
    expect(serverKey({})).toBeNull();
    expect(serverKey({ [SERVER_KEY_NAME]: '' })).toBeNull();
    expect(serverKey({ [SERVER_KEY_NAME]: '   ' })).toBeNull();
    expect(serverKey({ [SERVER_KEY_NAME]: undefined })).toBeNull();
  });

  it('reads process.env by default', () => {
    const before = process.env[SERVER_KEY_NAME];
    try {
      process.env[SERVER_KEY_NAME] = ` ${FAKE_KEY} `;
      expect(serverKey()).toBe(FAKE_KEY);
      delete process.env[SERVER_KEY_NAME];
      expect(serverKey()).toBeNull();
    } finally {
      if (before === undefined) delete process.env[SERVER_KEY_NAME];
      else process.env[SERVER_KEY_NAME] = before;
    }
  });
});
