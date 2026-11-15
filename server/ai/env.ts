// Server settings for the Gemini call (docs/mvp4.md F1, "Keys").
// `GEMINI_API_KEY` and the optional `GEMINI_MODEL` live in the environment or the repo-root `.env`, server only:
// never a `VITE_` variable, so the browser bundle cannot hold them. This file logs nothing and never puts the
// key into an error. The `.env` loader is the geo layer's one (server/index.ts already runs it when the server starts).
export { DEFAULT_ENV_PATH, loadDotEnv } from '../geo/env';

export const GEMINI_KEY_NAME = 'GEMINI_API_KEY';
export const GEMINI_MODEL_NAME = 'GEMINI_MODEL';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

type Env = Record<string, string | undefined>;

function trimmed(env: Env, name: string): string | null {
  const value = env[name];
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

/**
 * The trimmed GEMINI_API_KEY, or null when it is unset or blank.
 * No prefix check on purpose: new AI Studio keys are "auth keys" and may start with `AQ`, not `AIza`.
 */
export function geminiKey(env: Env = process.env): string | null {
  return trimmed(env, GEMINI_KEY_NAME);
}

/** The trimmed GEMINI_MODEL, or `gemini-2.5-flash` when it is unset or blank. */
export function geminiModel(env: Env = process.env): string {
  return trimmed(env, GEMINI_MODEL_NAME) ?? DEFAULT_GEMINI_MODEL;
}
