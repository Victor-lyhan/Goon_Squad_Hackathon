// #637: the page shell a browser gets before any script runs (client/index.html): the tab icon, the description
// and the theme colour. The icon is an inline SVG `data:` URI, so no file is added, the browser does not ask
// for /favicon.ico, and no other host is asked for anything.
import { existsSync, readFileSync } from 'node:fs';
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

/** `--accent` of tokens.css, e.g. "#28618A". */
const accent = /^\s*--accent:\s*(#[0-9A-Fa-f]{6})\s*;/m.exec(tokens)?.[1] ?? '';

const icons = tags.filter((t) => t.name === 'link' && (t.attrs.rel ?? '').split(/\s+/).includes('icon'));
const iconHref = icons[0]?.attrs.href ?? '';
const SVG_PREFIX = 'data:image/svg+xml,';
const svg = iconHref.startsWith(SVG_PREFIX) ? decodeURIComponent(iconHref.slice(SVG_PREFIX.length)) : '';

describe('client/index.html (#637)', () => {
  it('has exactly one icon, an inline SVG data: URI', () => {
    expect(icons).toHaveLength(1);
    expect(icons[0].attrs.type).toBe('image/svg+xml');
    expect(iconHref.startsWith(SVG_PREFIX)).toBe(true);
    expect(svg).toMatch(/^<svg xmlns='http:\/\/www\.w3\.org\/2000\/svg' viewBox='0 0 \d+ \d+'>/);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('the icon URI is safe inside the attribute: no raw <, >, # or double quote', () => {
    // A raw # would end the URI (the rest becomes a fragment); < and > are not valid in a URL.
    expect(iconHref).not.toMatch(/[<>#"]/);
    expect(iconHref).toContain('%3Csvg');
    // Every % starts an escape, so decodeURIComponent above read the same text a browser does.
    expect(iconHref.replace(/%[0-9A-F]{2}/g, '')).not.toContain('%');
  });

  it('the icon is well formed: every element is closed, and it has shapes to draw', () => {
    const open: string[] = [];
    let shapes = 0;
    for (const m of svg.matchAll(/<(\/?)([a-z]+)\b[^>]*?(\/?)>/g)) {
      const [, closing, name, selfClosing] = m;
      if (closing) expect(open.pop(), `</${name}>`).toBe(name);
      else if (!selfClosing) open.push(name);
      if (!closing && name !== 'svg') shapes += 1;
    }
    expect(open).toEqual([]);
    expect(shapes).toBeGreaterThanOrEqual(2);
    // Attribute values are single-quoted and balanced.
    expect((svg.match(/'/g) ?? []).length % 2).toBe(0);
  });

  it('the icon loads nothing: no link, image, script, style or url() inside it', () => {
    expect(svg).not.toMatch(/href|<image|<script|<style|<use|<foreignObject|url\(|@import/i);
    // The only address in it is the SVG namespace, which is a name and is never fetched.
    expect(svg.match(/https?:\/\/[^'"\s>]+/g)).toEqual(['http://www.w3.org/2000/svg']);
  });

  it('the icon and theme-color use the accent token of tokens.css', () => {
    expect(accent).toMatch(/^#[0-9A-Fa-f]{6}$/);
    const theme = tag('meta', 'name', 'theme-color');
    expect(theme).toHaveLength(1);
    expect(theme[0].attrs.content.toLowerCase()).toBe(accent.toLowerCase());
    expect(svg.toLowerCase()).toContain(`fill='${accent.toLowerCase()}'`);
    // Every colour of the icon is the accent or white.
    const colours = [...new Set((svg.match(/#[0-9A-Fa-f]{3,8}\b/g) ?? []).map((c) => c.toLowerCase()))];
    expect(colours.sort()).toEqual([accent.toLowerCase(), '#ffffff'].sort());
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

  it('asks no other host for anything: every href and src is a data: URI or a path of the app', () => {
    const urls = tags.flatMap((t) => [t.attrs.href, t.attrs.src].filter((url): url is string => url !== undefined));
    expect(urls.length).toBeGreaterThanOrEqual(2); // the icon and the entry script
    for (const url of urls) expect(url, url.slice(0, 40)).toMatch(/^(data:|\/(?!\/))/);
    // Outside the icon the file names no address at all.
    expect(html.replace(iconHref, '')).not.toMatch(/https?:|\/\//);
  });

  it('adds no icon file, and keeps the shell: lang, charset, viewport, title, root and the entry script', () => {
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
