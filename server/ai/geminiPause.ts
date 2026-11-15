// The Gemini pause (#884): a slow or failing key must never stall the demo twice. After one failed Gemini call
// (the time limit, an HTTP error, a network error or an unusable answer) POST /parse-request and POST /advise
// stop asking Gemini for 2 minutes and answer offline at once; then Gemini is tried again. A call that succeeds
// clears the pause.
// One pause object is shared by both routes: the server makes it once (server/index.ts) and
// server/api/v2/bootstrap.ts hands the same object to the parser and the advisor.
// It lives in memory only: it is not part of the run, is never saved, and a restart starts without a pause.
// This file logs nothing and reads no environment. A cause is fixed text (plus an HTTP status number): never
// the key, the sentence or Gemini's answer.
import type { GeminiUnavailableReason } from './gemini';

/** How long Gemini is left alone after one failed call. */
export const GEMINI_PAUSE_MS = 120_000;

export type GeminiPauseState = {
  /** Why Gemini is paused, in fixed words that read after "paused after": "timeout", "HTTP 429". */
  cause: string;
  /** Milliseconds until Gemini is tried again. Always above 0. */
  remainingMs: number;
};

export interface GeminiPause {
  /** While paused: why, and how long is left. Null when Gemini may be asked. */
  current(): GeminiPauseState | null;
  /** A Gemini call failed: no call for the next `pauseMs`, counted from now. */
  fail(cause: string): void;
  /** A Gemini call gave a usable answer: the pause is over. */
  clear(): void;
}

export type GeminiPauseOptions = {
  /** The clock, in milliseconds. Defaults to `Date.now`; tests give their own. */
  now?: () => number;
  /** Defaults to GEMINI_PAUSE_MS (2 minutes). */
  pauseMs?: number;
};

export function createGeminiPause(options: GeminiPauseOptions = {}): GeminiPause {
  const now = options.now ?? Date.now;
  const pauseMs = options.pauseMs ?? GEMINI_PAUSE_MS;
  let paused: { cause: string; until: number } | null = null;
  return {
    current() {
      if (paused === null) return null;
      const remainingMs = paused.until - now();
      if (remainingMs > 0) return { cause: paused.cause, remainingMs };
      paused = null;
      return null;
    },
    fail(cause) {
      paused = { cause, until: now() + pauseMs };
    },
    clear() {
      paused = null;
    },
  };
}

/** Why a Gemini call gave nothing: a reason of `GeminiUnavailable`, an answer that failed the checks, or a fault while reading it. */
export type GeminiFailure = GeminiUnavailableReason | 'invalid_answer' | 'error';

/**
 * The cause of a pause for a failed call, or null when the failure starts none: without a key or a model name
 * nothing was sent, so Gemini did not fail. Every HTTP error status counts (429, 5xx, and a refused key too).
 */
export function pauseCause(reason: GeminiFailure, status?: number | null): string | null {
  switch (reason) {
    case 'no_key':
    case 'no_model':
      return null;
    case 'timeout':
      return 'timeout';
    case 'network':
      return 'a network error';
    case 'http':
      return typeof status === 'number' && Number.isInteger(status) ? `HTTP ${status}` : 'an HTTP error';
    default:
      return 'an unusable answer';
  }
}

/** "Gemini paused after timeout, next try in 87 s." Fixed text and two numbers: safe to log. */
export function pausedMessage(state: GeminiPauseState): string {
  const seconds = Math.max(1, Math.ceil(state.remainingMs / 1000));
  return `Gemini paused after ${state.cause}, next try in ${seconds} s.`;
}
