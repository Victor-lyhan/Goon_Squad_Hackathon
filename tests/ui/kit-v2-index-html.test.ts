// #637, #784: the page shell a browser gets before any script runs (client/index.html): the tab icons, the
// description and the theme colour. The icons are the Relay logo files of client/public/brand, which Vite
// serves at /brand/ and copies into the build: same origin, and no other host is asked for anything.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync('client/index.html', 'utf8');
const tokens = readFileSync('client/src/styles/tokens.css', 'utf8');

type Tag = { name: string; attrs: Record<string, string> };
/** Every start tag of the file with its double-quoted attributes. Comments are not tags. */
const tags: Tag[] = [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/g)].map((m) => ({
  name: m[1],
  attrs: Object.fromEntries([...m[2].matchAll(/([a-z-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])),
}));
const tag = (name: string, attr: string, value: string) => tags.filter((t) => t.name === name && t.attrs[attr] === value);

/** `--ink` of tokens.css, the header's ground on every page (#955), e.g. "#0B0F17". */
const ink = /^\s*--ink:\s*(#[0-9A-Fa-f]{6})\s*;/m.exec(tokens)?.[1] ?? '';

/** Every icon link: `rel` holds "icon" (the tab icon) or is "apple-touch-icon" (the home-screen icon). */
const icons = tags.filter((t) => t.name === 'link' && /(^|\s)(icon|apple-touch-icon)(\s|$)/.test(t.attrs.rel ?? ''));

/** client/public is served at /, so `/brand/x` is the file client/public/brand/x. */
const BRAND_DIR = 'client/public/brand';
const fileOf = (href: string) => `client/public${href}`;
const bytes = (href: string) => readFileSync(fileOf(href));
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Width and height of a PNG, from its IHDR chunk (always the first one). */
const pngSize = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });
const isPng = (file: Buffer) => file.subarray(0, 8).equals(PNG_SIGNATURE);

describe('client/index.html (#637, #784)', () => {
  it('has exactly the three icon links of the Relay logo, in this order', () => {
    expect(icons.map((t) => t.attrs)).toEqual([
      { rel: 'icon', href: '/brand/favicon.ico', sizes: 'any' },
      { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/brand/icon-32.png' },
      { rel: 'apple-touch-icon', href: '/brand/icon-180.png' },
    ]);
  });

  it('every icon is a same-origin /brand/ path whose file is in client/public/brand', () => {
    const onDisk = readdirSync(BRAND_DIR);
    for (const { attrs } of icons) {
      // A plain path of the app: no scheme, no host, no data: URI, no query, nothing that leaves /brand/.
      expect(attrs.href).toMatch(/^\/brand\/[a-z0-9-]+\.(ico|png)$/);
      expect(existsSync(fileOf(attrs.href)), attrs.href).toBe(true);
      expect(onDisk, attrs.href).toContain(attrs.href.slice('/brand/'.length)); // the same letter case as the file
    }
    expect(html).not.toContain('data:'); // the inline SVG icon of #637 is gone
  });

  it('the icon files are what the links say: an ICO with a 32 px image, a 32 px PNG and a 180 px PNG', () => {
    // ICO: reserved 0, type 1 (icon), then the image count; each 16-byte entry starts with width and height.
    const ico = bytes('/brand/favicon.ico');
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]);
    const count = ico.readUInt16LE(4);
    expect(count).toBeGreaterThanOrEqual(1);
    const sizes = Array.from({ length: count }, (_, i) => ico.readUInt8(6 + 16 * i));
    expect(sizes).toContain(32);

    for (const [href, px] of [['/brand/icon-32.png', 32], ['/brand/icon-180.png', 180]] as const) {
      const png = bytes(href);
      expect(isPng(png), href).toBe(true);
      expect(pngSize(png), href).toEqual({ width: px, height: px });
    }
  });

  it('the logo the header and the homepage show is in the same folder: a square PNG with transparency', () => {
    const src = /LOGO_SRC = '([^']+)'/.exec(readFileSync('client/src/ui/brand.ts', 'utf8'))?.[1] ?? '';
    expect(src).toBe('/brand/relay-logo.png');
    const png = bytes(src);
    expect(isPng(png)).toBe(true);
    const { width, height } = pngSize(png);
    expect(width).toBe(height);
    expect(width).toBeGreaterThanOrEqual(192); // sharp at 96 px on a 2x screen
    expect(png.readUInt8(25)).toBe(6); // colour type 6 = RGBA, so the page background shows through
  });

  it('theme-color is the ink token of tokens.css: the browser bar of a phone continues the dark header (#955)', () => {
    expect(ink).toMatch(/^#[0-9A-Fa-f]{6}$/);
    const theme = tag('meta', 'name', 'theme-color');
    expect(theme).toHaveLength(1);
    expect(theme[0].attrs.content.toLowerCase()).toBe(ink.toLowerCase());
    // It is the colour the header is drawn in.
    expect(readFileSync('client/src/ui/shell.css', 'utf8')).toContain(`background: var(--ink, ${ink});`);
  });

  it('has a description that says what Relay is', () => {
    const description = tag('meta', 'name', 'description');
    expect(description).toHaveLength(1);
    const text = description[0].attrs.content;
    expect(text).toMatch(/^Relay /);
    for (const word of [/packages/, /commutes/, /relay point/, /simulate/, /New York City/]) expect(text).toMatch(word);
    expect(text).not.toMatch(/\bhubs?\b/i); // the product word is "relay point"
    // Short enough for a search result or a link preview, and one sentence.
    expect(text.length).toBeGreaterThanOrEqual(50);
    expect(text.length).toBeLessThanOrEqual(160);
    expect(text.endsWith('.')).toBe(true);
  });

  it('asks no other host for anything: every href and src is a path of the app', () => {
    const urls = tags.flatMap((t) => [t.attrs.href, t.attrs.src].filter((url): url is string => url !== undefined));
    expect(urls).toHaveLength(4); // the three icons and the entry script
    for (const url of urls) expect(url, url).toMatch(/^\/(?!\/)/);
    // The file names no address at all, also not in a comment.
    expect(html).not.toMatch(/https?:|\/\//);
  });

  it('adds no icon file outside client/public/brand, and keeps the shell: lang, charset, viewport, title, root and the entry script', () => {
    for (const file of ['client/favicon.ico', 'client/favicon.svg', 'client/public/favicon.ico', 'client/public/favicon.svg']) {
      expect(existsSync(file), file).toBe(false);
    }
    expect(html).toMatch(/^<!doctype html>\n<html lang="en">/);
    expect(tag('meta', 'charset', 'UTF-8')).toHaveLength(1);
    expect(tag('meta', 'name', 'viewport')).toHaveLength(1);
    expect(html).toContain('<title>Relay</title>');
    expect(tag('div', 'id', 'root')).toHaveLength(1);
    expect(tag('script', 'src', '/src/main.tsx')[0]?.attrs.type).toBe('module');
  });
});
