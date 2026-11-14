// #651 changed token values to the MVP III look (docs/mvp3.md P4) in client/src/styles/tokens.css.
// Component CSS outside client/src/ui/ and client/src/styles/ still writes the MVP II value as the
// fallback of var(--name, fallback) until its own restyle pass. That fallback is never drawn
// (tokens.css is always loaded through global.css), so the CSS QA tests accept either the current
// token value or the MVP II value listed here. Delete an entry when no stylesheet uses it any more.
export const MVP2_TOKEN_VALUES: Readonly<Record<string, string>> = {
  '--bg': '#F7F8FA',
  '--text': '#151B26',
  '--navy': '#151B26',
  '--border': '#D7DDE5',
  '--accent': '#28618A',
  '--accent-dark': '#1F4E70',
  '--accent-soft': '#E8F0F6',
  '--radius': '2px',
  '--radius-lg': '4px',
};

const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, '');

/** True when `fallback` is the MVP II value of token `name`. */
export function isMvp2Fallback(name: string, fallback: string): boolean {
  const old = MVP2_TOKEN_VALUES[name];
  return old !== undefined && norm(old) === norm(fallback);
}

/** The MVP II colours above, as hex strings. */
export const MVP2_TOKEN_COLORS: readonly string[] = [...new Set(Object.values(MVP2_TOKEN_VALUES).filter((v) => v.startsWith('#')))];
