// Keyboard QA for the merged MVP II simulator pieces (#479, M9): every control in the left and right
// panels is a real focusable element with a name and the right role/state, and its classes have a
// :focus-visible style in the CSS. Static renders only (Node, no DOM), like the other sim-v2 tests.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FocusSelector } from '../../client/src/components/sim/v2/FocusSelector';
import { PackageList } from '../../client/src/components/sim/v2/PackageList';
import { LEFT_BODY_ID, RIGHT_BODY_ID, SimWorkspace } from '../../client/src/components/sim/v2/SimWorkspace';
import { PlaybackControls } from '../../client/src/components/sim/v2/controls/PlaybackControls';
import { BUSY_REASON, type PlayButtonView } from '../../client/src/components/sim/v2/controls/controlsModel';
import { BusinessInspector } from '../../client/src/components/sim/v2/inspector/BusinessInspector';
import { EmployeeInspector } from '../../client/src/components/sim/v2/inspector/EmployeeInspector';
import { businessInspector, employeeInspector } from '../../client/src/components/sim/v2/inspector/inspectorModel';
import { JourneyTimeline } from '../../client/src/components/sim/v2/journey/JourneyTimeline';
import { buildJourney, type Journey } from '../../client/src/components/sim/v2/journey/journeyModel';
import { MapLegend } from '../../client/src/components/sim/v2/legend/MapLegend';
import { PackagePanel } from '../../client/src/components/sim/v2/packages/PackagePanel';
import * as inspectorFx from './sim-v2-inspector-fixture';
import { T, map as journeyMap, simAt } from './sim-v2-journey-sample';
import * as packagesFx from './sim-v2-packages-fixture';
import { FOCUS_SELECTORS } from './sim-v2-qa-css-rules';

const noop = () => {};
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const render = (el: ReactElement) => unescape(renderToStaticMarkup(el));
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const textOf = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
/** Text content without aria-hidden parts (icons, arrows). */
const visibleText = (h: string) => textOf(h.replace(/<span[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g, ''));

type Control = { tag: string; open: string; name: string };

/** Every focusable control in a static render with its accessible name (aria-label, <label for>, wrapping label, text). */
function controls(html: string): Control[] {
  const out: Control[] = [];
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const open = `<button${m[1]}>`;
    out.push({ tag: 'button', open, name: attr(open, 'aria-label') ?? visibleText(m[2]) });
  }
  for (const m of html.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
    const open = m[0];
    const id = attr(open, 'id');
    const forLabel = id ? html.match(new RegExp(`<label[^>]*for="${id}"[^>]*>([\\s\\S]*?)</label>`))?.[1] : undefined;
    const wrap = [...html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)].find((l) => l[1].includes(open))?.[1];
    out.push({ tag: m[1], open, name: attr(open, 'aria-label') ?? textOf(forLabel ?? wrap ?? '') });
  }
  return out;
}

const uiCss = readFileSync(resolve(__dirname, '../../client/src/ui/ui.css'), 'utf8');

/** A control's classes (or tag inside a styled parent) have a :focus-visible rule. */
function hasFocusStyle(c: Control, html: string): boolean {
  const classes = (attr(c.open, 'class') ?? '').split(/\s+/).filter(Boolean);
  if (classes.some((k) => FOCUS_SELECTORS.has(`.${k}`))) return true;
  if (classes.includes('ui-btn')) return uiCss.includes('.ui-btn:focus-visible');
  return [...FOCUS_SELECTORS].some((s) => {
    const m = /^\.([\w-]+) (\w+)$/.exec(s);
    return !!m && m[2] === c.tag && html.includes(m[1]);
  });
}

function expectReachable(html: string) {
  const all = controls(html);
  expect(all.length).toBeGreaterThan(0);
  for (const c of all) {
    expect(c.name, c.open).not.toBe('');
    expect(attr(c.open, 'tabindex'), c.open).not.toBe('-1');
    expect(hasFocusStyle(c, html), `no :focus-visible for ${c.open}`).toBe(true);
  }
  // Nothing clickable that is not a control.
  expect(html).not.toMatch(/<(div|span|li)\b[^>]*\sonclick/i);
  expect(html).not.toMatch(/role="button"/);
  return all;
}
const byName = (all: Control[], name: string | RegExp) =>
  all.filter((c) => (typeof name === 'string' ? c.name === name : name.test(c.name)));
const one = (all: Control[], name: string | RegExp) => {
  const found = byName(all, name);
  expect(found, String(name)).toHaveLength(1);
  return found[0];
};

describe('workspace frame: panel collapse buttons and Back to network', () => {
  const journey = { title: 'Brand proofs', onExit: noop };
  const open = render(<SimWorkspace map={<div />} left={<p>L</p>} right={<p>R</p>} journey={journey} />);
  const closed = render(
    <SimWorkspace map={<div />} left={<p>L</p>} right={<p>R</p>} initialPanels={{ leftOpen: false, rightOpen: false }} />,
  );

  it('each collapse button is named, says whether it is expanded and points at the panel body', () => {
    const all = expectReachable(open);
    const left = one(all, 'Controls');
    const right = one(all, 'Inspector');
    expect([attr(left.open, 'aria-expanded'), attr(left.open, 'aria-controls')]).toEqual(['true', LEFT_BODY_ID]);
    expect([attr(right.open, 'aria-expanded'), attr(right.open, 'aria-controls')]).toEqual(['true', RIGHT_BODY_ID]);
    for (const id of [LEFT_BODY_ID, RIGHT_BODY_ID]) expect(open).toContain(`id="${id}"`);
    const shut = expectReachable(closed);
    expect(shut.map((c) => attr(c.open, 'aria-expanded'))).toEqual(['false', 'false']);
  });

  it('"Back to network" is a named button', () => {
    expect(attr(one(controls(open), 'Back to network').open, 'type')).toBe('button');
  });
});

describe('left panel: playback (#648: one Play/Pause button and Back to start)', () => {
  const play: PlayButtonView = { label: 'Play', action: 'play_journey', note: null };
  const pause: PlayButtonView = { label: 'Pause', action: 'pause_journey', note: null };
  const html = (button: PlayButtonView, resetDisabled: string | null = null) =>
    render(<PlaybackControls button={button} resetDisabled={resetDisabled} onToggle={noop} onReset={noop} />);

  it.each([['Play', play], ['Pause', pause]] as const)('%s and Back to start are the two named buttons, in the tab order', (label, button) => {
    const all = expectReachable(html(button));
    expect(all.map((c) => [c.tag, attr(c.open, 'type'), c.name])).toEqual([['button', 'button', label], ['button', 'button', 'Back to start']]);
    for (const c of all) expect(c.open).not.toContain('disabled');
  });

  it('a disabled button stays named and is described by the visible reason', () => {
    const out = html({ label: 'Play', action: null, note: BUSY_REASON }, BUSY_REASON);
    const all = expectReachable(out);
    expect(all.map((c) => c.name)).toEqual(['Play', 'Back to start']);
    for (const c of all) {
      expect(c.open).toContain('disabled');
      const noteId = attr(c.open, 'aria-describedby');
      expect(noteId).toBeTruthy();
      expect(out).toContain(`id="${noteId}">${BUSY_REASON}<`);
    }
  });

  it('the step line is a live region that is there before anything plays', () => {
    expect(html(play)).toMatch(/<p class="ctl-status" role="status"><\/p>/);
  });
});

describe('left panel: focus, packages and the map legend', () => {
  it('the focus selector is two labelled selects and a button', () => {
    const all = expectReachable(render(
      <FocusSelector employees={[{ id: 'emp-1', label: 'Maya Chen' }]} businesses={[{ id: 'biz-a', label: 'Studio' }]}
        focus={{ kind: 'employee', id: 'emp-1' }} onChange={noop} />,
    ));
    expect(one(all, 'Focus on employee').tag).toBe('select');
    expect(one(all, 'Focus on business').tag).toBe('select');
    expect(one(all, 'Show everything').tag).toBe('button');
  });

  it('package rows are buttons named by their label and status, the selected one marked current', () => {
    const items = [
      { id: 'shp-1', label: 'Brand proofs', statusLabel: 'In transit', routeLabel: 'A → B' },
      { id: 'shp-2', label: 'Gift box', statusLabel: 'Delivered', routeLabel: 'C → D' },
    ];
    // #832: the list's Details toggle comes first: a named button, closed, that controls the list.
    const [details, ...all] = expectReachable(render(<PackageList items={items} selectedId="shp-2" onSelect={noop} />));
    expect(details.name).toBe('Details: packages');
    expect(attr(details.open, 'aria-expanded')).toBe('false');
    expect(all.map((c) => c.name)).toEqual(['Brand proofs In transit A → B', 'Gift box Delivered C → D']);
    expect(all.map((c) => attr(c.open, 'aria-current'))).toEqual([undefined, 'true']);
  });

  it('the package panel: labelled search, pressed state on the status filters, named rows', () => {
    const html = render(
      <PackagePanel sim={packagesFx.makeSim()} map={packagesFx.makeMap()} selectedId={undefined} onSelect={noop} />,
    );
    const all = expectReachable(html);
    expect(all.find((c) => c.tag === 'input')?.name).toBeTruthy();
    expect(all.filter((c) => c.open.includes('pk-chip')).every((c) => attr(c.open, 'aria-pressed'))).toBe(true);
  });

  it('the map legend toggle is named and expandable', () => {
    const all = expectReachable(render(<MapLegend mode="network" />));
    const t = all[0];
    expect(attr(t.open, 'aria-expanded')).toBe('true');
    expect(attr(t.open, 'aria-controls')).toBeTruthy();
  });
});

describe('right panel: inspectors and journey steps', () => {
  const handlers = { onSelectPackage: noop, onSelectEmployee: noop, onSelectBusiness: noop, onFocus: noop, onClear: noop };
  const sim = inspectorFx.makeSim();
  const map = inspectorFx.makeMap();

  it.each(Object.values(inspectorFx.BIZ))('business %s: every control is named and focusable; the name is the heading', (id) => {
    const model = businessInspector(id, sim, map);
    const html = render(<BusinessInspector model={model} {...handlers} />);
    const all = expectReachable(html);
    expect(one(all, 'Close business inspector').tag).toBe('button');
    if (model) expect(html).toContain(`<h2 class="insp-title">${model.name}</h2>`);
  });

  it.each(Object.values(inspectorFx.EMP))('employee %s: every control is named and focusable', (id) => {
    const html = render(<EmployeeInspector model={employeeInspector(id, sim, map)} {...handlers} />);
    expect(one(expectReachable(html), 'Close employee inspector').tag).toBe('button');
  });

  it('journey steps are buttons named "Step n: …", the current one marked as the step', () => {
    const j = buildJourney({ shipmentId: 'shp-2', sim: simAt(T.overnight, { 'shp-2': 'at_hub' }), map: journeyMap }) as Journey;
    // #832: the header's Details toggle comes first, named after the package.
    const [details, ...all] = expectReachable(render(<JourneyTimeline journey={j} onSeek={noop} />));
    expect(details.name).toBe(`Details: ${j.title}`);
    expect(attr(details.open, 'aria-expanded')).toBe('false');
    expect(all).toHaveLength(j.steps.length);
    all.forEach((c, i) => expect(c.name.startsWith(`Step ${i + 1}: `), c.name).toBe(true));
    expect(all.filter((c) => attr(c.open, 'aria-current') === 'step')).toHaveLength(1);
  });
});
