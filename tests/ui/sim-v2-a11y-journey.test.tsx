// @vitest-environment jsdom
// #725: the 30-second demo without a mouse and with a screen reader, on the REAL default NYC run (the in-memory
// DemoServer of demo-path-mvp3-helper.ts, no key, no network, fake timers). Checked by hand in headless Chrome at
// 1440 px with real Tab, Space and Enter keys; this file pins what jsdom can see:
//   - one polite live region says "Step n ...", once per step, never on a poll, and never "Journey complete" for
//     the moment between Play and its first step on a package that was already delivered;
//   - the Overnight card is announced once when it appears, through a live region that was already in the page;
//   - the Journey's status line in the Inspector is not a second live region;
//   - Play/Pause is one element whose accessible name is its state; keyboard focus stays on it for the whole
//     journey (the card and the step scroll of #718 never move it), and Back to start keeps focus while the run
//     is busy (aria-disabled, never disabled);
//   - Tab reaches Play/Pause, Back to start, the package list, Compare and the Inspector in visual order;
//   - journey.css has no MVP II fallback left, and the no-key panel's lead line is not heavier than Inter's 600.
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapKeyMissing } from '../../client/src/components/map/GoogleBaseMap';
import { KEY_MISSING_TEXT } from '../../client/src/components/map/mapModel';
import { JOURNEY_STEP_MS, OVERNIGHT_CARD_MS } from '../../client/src/components/sim/v2/motion/journeyPlayback';
import { DemoServer, advance, demoRun, mountApp, settleUntil, type MountedApp } from './demo-path-mvp3-helper';
import { parseCss, readTokens } from './employee-v2-qa-helpers';
import { MVP2_TOKEN_COLORS } from './kit-v2-legacy-tokens';
import { button, buttons, click, deferred, press, tabOrder, textOf } from './kitDom';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const google = vi.hoisted(() => ({ loads: 0 }));
vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: () => { google.loads += 1; },
  importLibrary: () => { google.loads += 1; return new Promise(() => {}); },
}));

/** The story package (DECISIONS pass 54: its label is the one story value a test may write). */
const STORY_LABEL = 'Navy Yard grinder burrs';

// ---------- The page ----------

function playPause(c: ParentNode): HTMLButtonElement {
  const all = buttons(c, /^(Play|Pause)$/);
  if (all.length !== 1) throw new Error(`playPause(): ${all.length} Play/Pause buttons`);
  return all[0];
}
const backToStart = (c: ParentNode) => button(c, 'Back to start');
const LIVE = '[role="status"], [role="alert"], [role="log"], [aria-live]:not([aria-live="off"])';
const liveRegions = (c: ParentNode) => [...c.querySelectorAll<HTMLElement>(LIVE)];
const stepLine = (c: ParentNode) => c.querySelector<HTMLElement>('.ctl-playback [role="status"]')!;
const announceSlot = (c: ParentNode) => c.querySelector<HTMLElement>('.spc-map > .spc-announce')!;
const steps = (c: ParentNode) => [...c.querySelectorAll<HTMLButtonElement>('.jt__steps .jt-step__button')];
const POLL = (r: { method: string; path: string }) => r.method === 'GET' && r.path === '/api/v2/simulator';

/** Every text a live region showed, in order, with the region it was in (empty texts are not read out). */
function recordAnnouncements(c: HTMLElement) {
  const heard: Array<{ region: HTMLElement; text: string }> = [];
  const last = new Map<HTMLElement, string>();
  const look = () => {
    for (const region of liveRegions(c)) {
      const text = textOf(region);
      if (last.get(region) === text) continue;
      last.set(region, text);
      if (text !== '') heard.push({ region, text });
    }
  };
  look();
  heard.length = 0; // what was on the page before the recording is not an announcement
  const observer = new MutationObserver(look);
  observer.observe(c, { subtree: true, childList: true, characterData: true, attributes: true });
  return { heard, stop: () => { look(); observer.disconnect(); } };
}

type Opened = { server: DemoServer; app: MountedApp; c: HTMLElement };

/** `/simulator?package=<story>` (no `play=1`: the keyboard starts it), loaded, nothing sent yet. */
async function openStory(over: { holdControls?: boolean; seekFirstTo?: (server: DemoServer) => number } = {}): Promise<Opened & { release: () => void; posts: () => number }> {
  const server = new DemoServer();
  const sim = server.simulator();
  const story = sim.shipments.find((s) => s.label === STORY_LABEL)!;
  expect(story, 'the default run has the story package').toBeTruthy();
  if (over.seekFirstTo) {
    const timeMin = over.seekFirstTo(server);
    await server.fetch('/api/v2/simulator/control', { method: 'POST', body: JSON.stringify({ action: 'seek', timeMin }) });
    server.requests.length = 0;
  }
  // Optionally hold every control answer until `release`, so the run stays busy as long as the test wants.
  let gate = deferred<void>();
  let posts = 0;
  const fetch = over.holdControls
    ? async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (init.method === 'POST') {
        posts += 1;
        await gate.promise;
      }
      return server.fetch(input, init);
    }
    : server.fetch;
  vi.stubGlobal('fetch', fetch);
  const app = mountApp(`/simulator?package=${encodeURIComponent(story.id)}`);
  const c = app.container;
  await settleUntil(() => steps(c).length > 0 && buttons(c, /^(Play|Pause)$/).length === 1, 'the story journey on screen');
  expect(server.controls()).toEqual([]);
  return { server, app, c, posts: () => posts, release: () => { gate.resolve(); gate = deferred<void>(); } };
}

/** Plays until the one button reads Play again (the journey ended), one step at a time, calling `each` after every step. */
async function playToEnd(c: HTMLElement, each: () => void = () => {}) {
  for (let i = 0; i < 200 && textOf(playPause(c)) === 'Pause'; i++) {
    await advance(JOURNEY_STEP_MS);
    each();
  }
  expect(textOf(playPause(c))).toBe('Play');
}

let scrolled: Element[] = [];
const originalScroll = Element.prototype.scrollIntoView;

beforeAll(() => { demoRun(); });
beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
  google.loads = 0;
  vi.useFakeTimers();
  scrolled = [];
  // jsdom has no layout: record which step asked to be shown (#718).
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this); } as Element['scrollIntoView'];
});
afterEach(() => {
  Element.prototype.scrollIntoView = originalScroll;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  expect(google.loads).toBe(0);
});

describe('screen readers: what the journey announces (#725)', () => {
  it('one polite live region says "Step n", once per step and never on a poll; the Inspector status is not live', async () => {
    const { server, c } = await openStory();
    // The one region for the steps; the journey's own status line in the Inspector shows the status but is silent.
    const status = c.querySelector<HTMLElement>('.jt__status')!;
    expect(status.getAttribute('aria-live')).toBeNull();
    expect(status.getAttribute('role')).toBeNull();
    expect(stepLine(c).getAttribute('role')).toBe('status'); // polite by its role

    const rec = recordAnnouncements(c);
    const line = stepLine(c);
    const polls = server.requests.filter(POLL).length;
    click(playPause(c));
    await playToEnd(c);
    rec.stop();

    const said = rec.heard.filter((h) => h.region === line).map((h) => h.text);
    const n = steps(c).length;
    expect(n).toBeGreaterThanOrEqual(4);
    // Each step once, in order, then the end: the line changes only when the current step does.
    expect(said.slice(0, n).map((t) => /^Step (\d+) of (\d+) next: /.exec(t)?.slice(1).map(Number))).toEqual(
      Array.from({ length: n }, (_, i) => [i + 1, n]),
    );
    expect(said.slice(n)).toHaveLength(1);
    expect(said[n]).toMatch(/^Journey complete: /);
    // The page polled many times meanwhile, and no poll was read out.
    expect(server.requests.filter(POLL).length - polls).toBeGreaterThan(said.length);
    // Only the step line and the overnight slot spoke: no other region (map, package count, banners).
    expect(new Set(rec.heard.map((h) => h.region))).toEqual(new Set([line, announceSlot(c)]));
    // No region other than the step line ever carried a step.
    expect(rec.heard.filter((h) => h.region !== line && /\bStep \d/.test(h.text))).toEqual([]);
  });

  it('the Overnight card is announced once, through a live region that was in the page before it', async () => {
    const { c } = await openStory();
    const slot = announceSlot(c);
    expect(slot.getAttribute('role')).toBe('status');
    expect(textOf(slot)).toBe('');
    const rec = recordAnnouncements(c);
    click(playPause(c));
    let cardSeen = 0;
    await playToEnd(c, () => { if (c.querySelector('.spc-overnight')) cardSeen += 1; });
    rec.stop();

    expect(cardSeen).toBeGreaterThan(0);
    expect(announceSlot(c)).toBe(slot); // the same element all along: mounted once, filled and emptied
    const said = rec.heard.filter((h) => h.region === slot).map((h) => h.text);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^Overnight at \S/);
    // The card itself is not a second region inside the first.
    expect(liveRegions(slot)).toEqual([]);
  });

  it('Play on a package that was already delivered does not say "Journey complete" before its first step', async () => {
    // The server clock is past the delivery, as after a full run: the timeline shows every step done.
    const { c } = await openStory({
      seekFirstTo: (server) => {
        const sim = server.simulator();
        const id = sim.shipments.find((s) => s.label === STORY_LABEL)!.id;
        const legs = sim.plans.find((p) => p.shipmentId === id)!.legs;
        return Math.max(...legs.flatMap((l) => l.stops.map((s) => s.serviceEndMin))) + 30;
      },
    });
    expect(steps(c).every((s) => s.getAttribute('aria-current') === null)).toBe(true);
    const rec = recordAnnouncements(c);
    click(playPause(c));
    // Before the first step has landed: the line is empty, not the end of the journey.
    expect(textOf(playPause(c))).toBe('Pause');
    expect(textOf(stepLine(c))).toBe('');
    await advance(0);
    await playToEnd(c);
    rec.stop();
    const said = rec.heard.filter((h) => h.region === stepLine(c)).map((h) => h.text);
    expect(said[0]).toMatch(/^Step 1 of \d+ next: /);
    expect(said.filter((t) => t.startsWith('Journey complete'))).toHaveLength(1);
    expect(said[said.length - 1]).toMatch(/^Journey complete: /);
  });
});

describe('keyboard: Play/Pause, Back to start and the Tab order (#725)', () => {
  it('Play/Pause is one element whose name is its state, and focus stays on it through the card and every step', async () => {
    const { c } = await openStory();
    const btn = playPause(c);
    expect(btn.getAttribute('aria-label')).toBeNull(); // the name is the visible label
    expect(btn.getAttribute('aria-pressed')).toBeNull(); // the label changes, so no pressed state on top
    btn.focus();
    expect(document.activeElement).toBe(btn);

    click(btn);
    expect(textOf(btn)).toBe('Pause');
    const names = new Set<string>();
    let cardSeen = false;
    await playToEnd(c, () => {
      expect(playPause(c)).toBe(btn); // never re-mounted
      expect(document.activeElement).toBe(btn); // never moved by the card or by the scroll to the current step
      names.add(textOf(btn));
      if (c.querySelector('.spc-overnight')) cardSeen = true;
    });
    expect(cardSeen).toBe(true);
    expect(scrolled.length).toBeGreaterThan(1); // the timeline kept its current step in view meanwhile
    expect(names).toEqual(new Set(['Pause', 'Play']));
    expect(document.activeElement).toBe(btn);
  });

  it('Space on the page and a press of the focused button toggle the same journey; the name follows', async () => {
    const { server, c } = await openStory();
    const btn = playPause(c);
    press(' ', document.body); // Space anywhere outside a control: the one button
    expect(textOf(btn)).toBe('Pause');
    await advance(2 * JOURNEY_STEP_MS);
    const sent = server.seeks().length;
    expect(sent).toBeGreaterThan(0);

    btn.focus();
    click(btn); // what Space or Enter does on the focused button in a browser
    expect(textOf(btn)).toBe('Play');
    expect(textOf(stepLine(c))).toBe('Journey paused.');
    await advance(5 * JOURNEY_STEP_MS);
    expect(server.seeks()).toHaveLength(sent);

    // Space on the focused button is left to the button (no double toggle from the page's key map).
    press(' ', btn);
    expect(textOf(btn)).toBe('Play');
    click(btn);
    expect(textOf(btn)).toBe('Pause');
    expect(document.activeElement).toBe(btn);
  });

  it('Back to start keeps keyboard focus while the run is busy: aria-disabled, never disabled', async () => {
    const { c, release, posts } = await openStory({ holdControls: true });
    const reset = backToStart(c);
    reset.focus();
    click(reset);
    await advance(0);
    // The reset is in flight: the button says it is unavailable and why, and it is still the focused element.
    expect(reset.getAttribute('aria-disabled')).toBe('true');
    expect(reset.disabled).toBe(false);
    expect(reset.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.activeElement).toBe(reset);
    expect(tabOrder(c)).toContain(reset);
    // A second press while busy sends nothing more (no click handler while aria-disabled).
    expect(posts()).toBe(1);
    click(reset);
    await advance(0);
    expect(posts()).toBe(1);
    release();
    await advance(0);
    expect(reset.getAttribute('aria-disabled')).toBeNull();
    expect(document.activeElement).toBe(reset);
    expect(playPause(c).disabled).toBe(false);
  });

  it('Tab reaches Play/Pause, Back to start, the package list, Compare and the Inspector in visual order', async () => {
    const { c } = await openStory();
    const order = tabOrder(c);
    const at = (el: Element | null | undefined, what: string) => {
      const i = order.indexOf(el as HTMLElement);
      expect(i, `${what} is in the Tab order`).toBeGreaterThanOrEqual(0);
      return i;
    };
    const right = c.querySelector('#sim-v2-right-body')!;
    const packages = c.querySelector('section[aria-labelledby="sw-section-packages"]')!;
    const positions = [
      at(button(c, /Controls/), 'the Controls panel toggle'),
      at(playPause(c), 'Play/Pause'),
      at(backToStart(c), 'Back to start'),
      at(packages.querySelector('input'), 'the package search'),
      at(packages.querySelector('ul[aria-label="Packages"] button'), 'the first package row'),
      at(button(c, 'Compare'), 'Compare'),
      at(button(c, /Inspector/), 'the Inspector panel toggle'),
      at(steps(c)[0], 'the first journey step'),
      at(right.querySelector('.spc-back'), 'Back to network in the Inspector'),
    ];
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // No positive tabindex anywhere: Tab follows the document, which is the visual left-to-right order.
    expect([...c.querySelectorAll<HTMLElement>('[tabindex]')].filter((el) => el.tabIndex > 0)).toEqual([]);
  });

  it('the step scroll leaves a keyboard reader on another step alone (#718 scroll, #725 guard)', async () => {
    const { c } = await openStory();
    const last = steps(c)[steps(c).length - 1];
    last.focus();
    press(' ', document.body); // Space from the page; the step button keeps focus
    scrolled = [];
    await advance(6 * JOURNEY_STEP_MS + OVERNIGHT_CARD_MS);
    expect(document.activeElement).toBe(last);
    expect(scrolled).toEqual([]);
  });
});

// ---------- CSS: the last MVP II leftovers (#725) ----------

const JOURNEY_CSS = 'client/src/components/sim/v2/journey/journey.css';
const MAP_CSS = 'client/src/components/map/map.css';
const tokens = readTokens();

describe('journey.css: MVP III tokens only', () => {
  const css = readFileSync(JOURNEY_CSS, 'utf8');
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('has none of the MVP II fallbacks', () => {
    for (const literal of ['#151B26', '#D7DDE5', '#28618A', 'IBM Plex Sans']) expect(code.toUpperCase()).not.toContain(literal.toUpperCase());
    for (const old of Object.values(MVP2_TOKEN_COLORS)) {
      if (Object.values(Object.fromEntries(tokens)).some((v) => v.toUpperCase() === old.toUpperCase())) continue; // same value in MVP III
      expect(code.toUpperCase(), `MVP II colour ${old}`).not.toContain(old.toUpperCase());
    }
  });

  it('every var() is a tokens.css token, alone or with a fallback that repeats the token', () => {
    const bad: string[] = [];
    for (const rule of parseCss(css)) {
      for (const d of rule.decls) {
        for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g)) {
          const token = tokens.get(m[1]);
          if (token === undefined) bad.push(`${rule.selector} { ${d.prop}: ${d.value} }: ${m[1]} is not a token`);
          else if (m[2] !== undefined && m[2].trim().replace(/\s+/g, '').toLowerCase() !== token.replace(/\s+/g, '').toLowerCase()) {
            bad.push(`${rule.selector} { ${d.prop}: ${d.value} }: the fallback is not ${token}`);
          }
        }
        if (/#[0-9a-f]{3,8}\b/i.test(d.value.replace(/var\([^)]*\)/g, ''))) bad.push(`${rule.selector} { ${d.prop}: ${d.value} }: a colour literal`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('the no-key panel: "Google Maps key missing." is not heavier than the loaded Inter', () => {
  it('renders the lead line in a <strong> inside .map-v2__panel', () => {
    const html = renderToStaticMarkup(<MapKeyMissing />);
    expect(html).toMatch(/^<div class="map-v2__panel" role="status"><strong>Google Maps key missing\.<\/strong>/);
    expect(KEY_MISSING_TEXT).toBe('Google Maps key missing.');
  });

  it('map.css sets the panel\'s <strong> to 600 at most, and fonts.css loads Inter up to that weight', () => {
    const rules = parseCss(readFileSync(MAP_CSS, 'utf8'));
    const weights = rules
      .filter((r) => r.selector.split(',').map((s) => s.trim().replace(/\s+/g, ' ')).includes('.map-v2__panel strong'))
      .flatMap((r) => r.decls.filter((d) => d.prop === 'font-weight').map((d) => d.value));
    expect(weights).toEqual(['600']);
    // Inter's heaviest loaded file is 600; the panel's text is the UI font (no own font-family on the panel).
    const inter = [...readFileSync('client/src/styles/fonts.css', 'utf8').matchAll(/@fontsource\/inter\/latin-(\d+)\.css/g)].map((m) => Number(m[1]));
    expect(Math.max(...inter)).toBe(600);
    expect(Number(weights[0])).toBeLessThanOrEqual(Math.max(...inter));
  });
});
