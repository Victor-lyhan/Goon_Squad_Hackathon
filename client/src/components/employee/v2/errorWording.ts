// #916: which error text the Employee page prints as it is. An error's message is shown only when it is a
// sentence written for the person on the page. Two kinds of text are not, and the page says its own plain
// sentence in their place:
//   1. the HTTP client's and the browser's own wording ("Request failed (500)", "Failed to fetch");
//   2. any text with a word this page does not say: "server", "key", "Google", "API", "ms", or a status
//      number. That covers the sentences the API layer writes when the server sent none ("The Relay
//      server had a problem, ...") and the server's hints for whoever runs Relay ("Add ... to .env and
//      restart the server"). The API layer does not export its sentences, so they are told by their words.
// The page still branches on `status`, `kind` and `code` first; this only decides about the leftover text.
// Pure; no import, so every Employee model can use it.

/** The HTTP client's own wording: a status with no message from the server, or the browser's fetch error. */
const CLIENT_WORDING = /^(Request failed|Request timed out|Request aborted|Failed to fetch|fetch failed|Network error|Load failed|NetworkError)/i;
/** Words the Employee page never says, and a 3-digit status number. "ms" only in lower case, as a unit. */
const NOT_PLAIN = /\b(servers?|keys?|apis?)\b|google|\b[1-5]\d\d\b/i;
const MILLISECONDS = /\bms\b/;

/** `message` when it is a sentence to show as it is; '' for an empty one and for the two kinds above. */
export function ownSentence(message: unknown): string {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text || CLIENT_WORDING.test(text) || NOT_PLAIN.test(text) || MILLISECONDS.test(text)) return '';
  return text;
}
