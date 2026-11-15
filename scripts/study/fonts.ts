// The study page's fonts: Inter for text and IBM Plex Mono for numbers (docs/mvp3.md P4), the same
// self-hosted @fontsource files the app loads through client/src/styles/fonts.css, written into the page as
// data: URLs. The page stays one file that asks the server for nothing (DECISIONS.md, pass 83), and a machine
// without the two fonts installed still shows them: before #887 the page only named them, so it was drawn in
// the system font (San Francisco and Menlo on a Mac) while the rest of the app was in Inter.
// Latin subset only, and only the four faces the page uses (Inter 400 and 600, IBM Plex Mono 400 and 600):
// about 105 KB of the page, which stays under 150 KB. Deterministic: the files come from the versions pinned in
// package-lock.json, so a new @fontsource version changes the page's bytes and `npm run study -- --check`
// then asks for a regenerated page.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export type EmbeddedFont = { family: string; weight: number; file: string };

/**
 * The faces the page embeds. page.ts uses no other weight of either family, so no bold is ever faked: text
 * is 400 or 600, a number is 400 in a table or a chart and 600 in the headline band and where it is the
 * figure of a row.
 */
export const EMBEDDED_FONTS: readonly EmbeddedFont[] = [
  { family: 'Inter', weight: 400, file: '@fontsource/inter/files/inter-latin-400-normal.woff2' },
  { family: 'Inter', weight: 600, file: '@fontsource/inter/files/inter-latin-600-normal.woff2' },
  { family: 'IBM Plex Mono', weight: 400, file: '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2' },
  { family: 'IBM Plex Mono', weight: 600, file: '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2' },
];

let cached: string | null = null;

/** The `@font-face` rules of the page, one per embedded face, each with its file as a base64 data: URL. */
export function embeddedFontCss(): string {
  if (cached === null) {
    cached = EMBEDDED_FONTS.map(({ family, weight, file }) => {
      const bytes = fs.readFileSync(path.join(repoRoot, 'node_modules', ...file.split('/')));
      const name = family.includes(' ') ? `"${family}"` : family;
      return `@font-face{font-family:${name};font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${bytes.toString('base64')}) format("woff2")}`;
    }).join('\n');
  }
  return cached;
}
