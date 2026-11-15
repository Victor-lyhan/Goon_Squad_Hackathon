// #511 (M9): the assembled MVP II simulator page against docs/mvp2-ui-redesign.md §1, line by line,
// rendered from the sample responses (static markup, DECISIONS pass 43). Every value asserted here is
// in the sample responses; the page computes no status, time or metric.
import { describe, expect, it } from 'vitest';
import * as layers from '../../client/src/components/map/layers';
import { PAUSE_LABEL, PLAY_LABEL } from '../../client/src/components/sim/v2/compose/journeyPlay';
import { BACK_TO_NETWORK } from '../../client/src/components/sim/v2/compose/simPageView';
import { formatCents, formatMin } from '../../client/src/ui/format';
import type { DeliveryPlan } from '../../shared/v2/types';
import {
  FOUR_STATES, SELECTED_STATES, accessibleName, all, ancestors, byClass, elements, hasClass, one, parse, readText,
  renderBody, textOf, type Node, type PageState,
} from './sim-v2-pageqa-sample';
import { RULES as SIM_RULES } from './sim-v2-qa-css-rules';

type Rendered = PageState & { html: string; root: Node; left: Node; right: Node; mapRegion: Node };
const rendered = (s: PageState): Rendered => {
  const html = renderBody(s);
  const root = parse(html);
  return {
    ...s, html, root,
    left: one(root, (n) => n.tag === 'aside' && hasClass(n, 'sw-left'), 'left panel'),
    right: one(root, (n) => n.tag === 'aside' && hasClass(n, 'sw-right'), 'right panel'),
    mapRegion: one(root, (n) => n.attrs.role === 'region' && n.attrs['aria-label'] === 'Map', 'map region'),
  };
};
const STATES = FOUR_STATES.map(rendered);
const SELECTED = SELECTED_STATES.map(rendered);
const byName = (name: string) => STATES.concat(SELECTED).find((x) => x.name === name)!;
const buttonsNamed = (root: Node, name: string | RegExp, scope: Node = root) =>
  all(scope, (n) => n.tag === 'button').filter((b) => {
    const nm = accessibleName(b, root);
    return typeof name === 'string' ? nm === name : name.test(nm);
  });
const headings = (n: Node) => all(n, (x) => /^h[1-6]$/.test(x.tag)).map(readText);

describe('doc §1: "No cards or metrics above the map. The simulator spans the whole screen horizontally."', () => {
  it.each(STATES)('$name: the workspace is left panel | map | right panel, nothing before it', (s) => {
    const page = one(s.root, (n) => hasClass(n, 'sim-v2'), 'workspace');
    expect(s.root.children).toEqual([page]); // nothing rendered before or around the workspace
    const [frame, ...rest] = elements(page);
    expect(hasClass(frame, 'sw-frame')).toBe(true);
    expect(rest.map((n) => n.attrs.class)).toEqual(['sw-narrow']); // the narrow-screen note only
    expect(elements(frame)).toEqual([s.left, s.mapRegion, s.right]);
  });

  it('the frame is one full-width row (fixed below the app header, edge to edge) with the map taking the rest', () => {
    const rule = (sel: string) => SIM_RULES.find((r) => !r.media && r.selectors.includes(sel))!;
    const decl = (sel: string, p: string) => rule(sel).decls.find(([k]) => k === p)?.[1];
    expect([decl('.sim-v2', 'position'), decl('.sim-v2', 'left'), decl('.sim-v2', 'right')]).toEqual(['fixed', '0', '0']);
    expect(decl('.sw-frame', 'display')).toBe('flex');
    expect(decl('.sw-frame', 'flex-direction')).toBeUndefined(); // row: the panels sit beside the map
    expect(decl('.sw-frame', 'width')).toBe('100%');
    expect(decl('.sw-map', 'flex')).toBe('1 1 auto');
  });

  it.each(STATES)('$name: no metric and no card outside the right panel', (s) => {
    for (const area of [s.left, s.mapRegion]) {
      expect(byClass(area, 'sw-summary')).toEqual([]);
      expect(all(area, (n) => n.tag === 'dl')).toEqual([]);
      expect(readText(area)).not.toMatch(/Delivered \/ requested|Matched \/ requested|extra minutes per trip/i);
    }
    expect(all(s.root, (n) => /(^|[\s_-])card([\s_-]|$)/i.test(n.attrs.class ?? ''))).toEqual([]);
  });

  it.each(STATES)('$name: the map region holds the floating playback group (#831), the map, then its legend and banners only', (s) => {
    const slot = one(s.mapRegion, (n) => hasClass(n, 'spc-map'), 'map slot');
    expect(elements(s.mapRegion)).toEqual([slot]);
    const [playbar, map, legend, ...rest] = elements(slot);
    // First, so Tab reaches Play before the map's own stops; CSS floats it at the bottom center.
    expect(hasClass(playbar, 'spc-playbar')).toBe(true);
    expect([playbar.attrs.role, playbar.attrs['aria-label']]).toEqual(['group', 'Playback']);
    expect(hasClass(map, 'map-v2')).toBe(true);
    expect(hasClass(legend, 'spc-legend')).toBe(true);
    // #725: last, the always-mounted live region the Overnight card is put into (empty here).
    const announce = rest.pop()!;
    expect(hasClass(announce, 'spc-announce')).toBe(true);
    expect(announce.attrs.role).toBe('status');
    for (const b of rest) expect(hasClass(b, 'spc-banner')).toBe(true);
  });
});

// docs/mvp3.md P1 + P2 (#648) replaces the doc's "scenario, playback, layer toggles, focus selector,
// Start new planning cycle": the setup form, the speed, scrubber and next-event controls and the layer
// toggles are deleted; playback is one Play/Pause button and "Back to start".
// #831 (human request): playback left the left panel; it floats at the bottom center of the map.
describe('doc §1 with docs/mvp3.md P2: "Left panel (controls, collapsible)": packages, focus selector, comparison; playback on the map (#831)', () => {
  it.each(STATES)('$name: every group is in the left panel, the panel has a collapse button', (s) => {
    expect(headings(s.left).filter((h) => ['Playback', 'Packages', 'Focus', 'Direct only vs relay points'].includes(h)))
      .toEqual(['Packages', 'Focus', 'Direct only vs relay points']);
    const toggle = buttonsNamed(s.root, 'Controls', s.left);
    expect(toggle).toHaveLength(1);
    expect(toggle[0].attrs['aria-expanded']).toBe('true');
  });

  it.each(STATES)('$name: playback: one Play/Pause button and Back to start, nothing else', (s) => {
    // One group on the page, in the map region: no panel scroll or collapse can hide it.
    const section = one(s.root, (n) => hasClass(n, 'spc-playbar'), 'playback');
    expect(ancestors(section)).toContain(s.mapRegion);
    expect(all(s.left, (n) => hasClass(n, 'ctl-playback'))).toEqual([]);
    const names = all(section, (n) => n.tag === 'button').map((b) => accessibleName(b, s.root));
    expect(names).toEqual([s.sim.clock.playing ? PAUSE_LABEL : PLAY_LABEL, 'Back to start']);
    expect(all(section, (n) => ['input', 'select'].includes(n.tag))).toEqual([]);
    // The step line of a playing journey: in the page from the start, empty until something plays.
    const status = one(section, (n) => n.attrs.role === 'status', 'step line');
    expect(readText(status)).toBe('');
  });

  it.each(STATES)('$name: removed in mvp3 P2: no setup form, speed, scrubber, next event, layer toggles or key hints', (s) => {
    expect(headings(s.root).filter((h) => ['Scenario', 'Layers', 'Planning cycle'].includes(h))).toEqual([]);
    expect(all(s.root, (n) => n.tag === 'form')).toEqual([]);
    expect(all(s.root, (n) => n.tag === 'input' && ['range', 'checkbox', 'number'].includes(n.attrs.type))).toEqual([]);
    for (const name of [
      'Generate', 'Start new planning cycle', 'Recompute matches', 'Next event', 'Jump to morning', 'Finish', 'Reset playback', /^Speed /,
    ]) {
      expect(buttonsNamed(s.root, name), String(name)).toEqual([]);
    }
    expect(all(s.root, (n) => n.tag === 'kbd')).toEqual([]);
    expect(readText(s.root)).not.toMatch(/\b(Space|Esc)\b/);
  });

  it.each(STATES)('$name: focus selector: one employee or one business, from the sample map', (s) => {
    const section = one(s.left, (n) => n.attrs['aria-labelledby'] === 'sw-section-focus', 'focus');
    const selects = all(section, (n) => n.tag === 'select');
    expect(selects.map((n) => accessibleName(n, s.root))).toEqual(['Focus on employee', 'Focus on business']);
    const [emp, biz] = selects.map((sel) => all(sel, (o) => o.tag === 'option'));
    expect(emp.filter((o) => o.attrs.value).map(readText).sort()).toEqual(s.map.employees.map((e) => e.name).sort());
    expect(biz.filter((o) => o.attrs.value).map(readText).sort()).toEqual(s.map.businesses.map((b) => b.name).sort());
    const chosen = (opts: Node[]) => opts.find((o) => o.attrs.selected !== undefined)?.attrs.value ?? '';
    expect([chosen(emp), chosen(biz)]).toEqual([
      s.focus.kind === 'employee' ? s.focus.id : '',
      s.focus.kind === 'business' ? s.focus.id : '',
    ]);
  });

  it.each(STATES)('$name: the package list holds every sample package as a button (journey mode entry point)', (s) => {
    const list = one(s.left, (n) => n.tag === 'ul' && n.attrs['aria-label'] === 'Packages', 'package list');
    const rows = all(list, (n) => n.tag === 'button');
    expect(rows.map((r) => textOf(all(r, (x) => hasClass(x, 'sw-pkg-label'))[0])).sort())
      .toEqual(s.sim.shipments.map((x) => x.label).sort());
    const current = rows.filter((r) => r.attrs['aria-current'] === 'true');
    expect(current.length).toBe(s.selection?.kind === 'package' ? 1 : 0);
  });
});

describe('doc §1: "Right panel: the selected item… When nothing is selected, a compact summary"', () => {
  const summaryRows = (r: Rendered) => byClass(r.right, 'sw-summary-row').map((row) => {
    const [dt, dd] = elements(row);
    return [readText(dt), readText(dd)];
  });

  it.each(STATES.filter((s) => s.selection === null))('$name: nothing selected: delivered, matched, average extra minutes', (s) => {
    const m = s.sim.snapshot.metrics;
    expect(summaryRows(s)).toEqual([
      ['Delivered', `${m.delivered} / ${m.requested}`],
      ['Matched', `${m.matched} / ${m.requested}`],
      ['Extra per trip', `${m.avgExtraMinPerTrip} min`],
    ]);
    expect(byClass(s.right, 'jt')).toEqual([]);
    expect(all(s.right, (n) => (n.attrs['data-testid'] ?? '').startsWith('insp-'))).toEqual([]);
  });

  it.each(SELECTED)('$name: the inspector, not the summary', (s) => {
    expect(summaryRows(s)).toEqual([]);
    const kind = s.selection!.kind;
    const panel = one(s.right, (n) => n.attrs['data-testid'] === `insp-${kind}`, 'inspector');
    const name = kind === 'business'
      ? s.map.businesses.find((b) => b.id === s.selection!.id)!.name
      : s.map.employees.find((e) => e.id === s.selection!.id)!.name;
    expect(headings(panel)[0]).toBe(name);
  });

  it.each(STATES.filter((s) => s.selection?.kind === 'package'))('$name: the journey timeline, not the summary', (s) => {
    expect(summaryRows(s)).toEqual([]);
    expect(byClass(s.right, 'jt')).toHaveLength(1);
  });

  it.each(STATES)('$name: the right panel has a collapse button', (s) => {
    const [toggle] = buttonsNamed(s.root, 'Inspector', s.right);
    expect(toggle.attrs['aria-expanded']).toBe('true');
  });
});

// ---------- Package journey mode ----------
/** The doc's order: 1 Pickup at sender → 2 Drop at relay → 3 Pickup at relay next morning → 4 Delivered. */
const DOC_STEPS = {
  relay: ['Pickup at sender', 'Drop at relay point', 'Pickup at relay point', 'Delivered to recipient'],
  direct: ['Pickup at sender', 'Delivered to recipient'],
};
const planOf = (s: Rendered) => s.sim.plans.find((p) => p.shipmentId === s.selection!.id) as DeliveryPlan;
const nameOf = (s: Rendered, employeeId: string) => s.map.employees.find((e) => e.id === employeeId)!.name;
const bizName = (s: Rendered, id: string) => s.map.businesses.find((b) => b.id === id)!.name;
const rgbHex = (c: readonly number[]) => `#${c.slice(0, 3).map((n) => n.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
const JOURNEYS = STATES.filter((s) => s.selection?.kind === 'package');

describe('doc §1: package journey mode', () => {
  it.each(JOURNEYS)('$name: the timeline shows the numbered steps in the doc order', (s) => {
    const plan = planOf(s);
    const steps = all(byClass(s.right, 'jt')[0], (n) => hasClass(n, 'jt-step'));
    expect(steps.map((li) => textOf(byClass(li, 'jt-step__n')[0]))).toEqual(steps.map((_, i) => String(i + 1)));
    expect(steps.map((li) => readText(byClass(li, 'jt-step__label')[0]))).toEqual(
      DOC_STEPS[plan.kind].map((label, i) => `Step ${i + 1}: ${label}`),
    );
  });

  it.each(JOURNEYS)('$name: each step: time, place, carrier and extra minutes from the plan, plus the status', (s) => {
    const plan = planOf(s);
    const stops = plan.legs.flatMap((leg) => leg.stops.map((stop) => ({ leg, stop })));
    const steps = all(byClass(s.right, 'jt')[0], (n) => hasClass(n, 'jt-step'));
    expect(steps).toHaveLength(stops.length);
    steps.forEach((li, i) => {
      const { leg, stop } = stops[i];
      expect(readText(byClass(li, 'jt-step__place')[0])).toBe(bizName(s, stop.placeId));
      // #832: the time is on the step's one line; the carrier and the extra minutes are under Details.
      expect(readText(byClass(li, 'jt-step__time')[0])).toBe(formatMin(stop.serviceEndMin));
      expect(elements(byClass(li, 'jt-step__meta')[0]).map(readText)).toEqual([
        nameOf(s, leg.employeeId), `+${leg.extraMin} min extra`,
      ]);
    });
    expect(readText(byClass(s.right, 'jt__status')[0])).toMatch(/^Status \S/);
    if (plan.kind === 'relay') {
      // Drop on Day 1, pickup at the same relay business on Day 2 ("next morning").
      expect(stops[1].stop.placeId).toBe(plan.relayBusinessId);
      expect(stops[2].stop.placeId).toBe(plan.relayBusinessId);
      expect(formatMin(stops[2].stop.serviceEndMin)).toMatch(/^Day 2, \d+:\d\d AM$/);
    }
  });

  it.each(JOURNEYS)('$name: the legend says which carrier has which colour', (s) => {
    const plan = planOf(s);
    const legend = one(s.right, (n) => n.attrs['aria-label'] === 'Journey legend', 'journey legend');
    // One row per carrier (#659): its letter badge in its colour, then "A · <name>" / "B · <name>".
    const items = byClass(legend, 'jl__item').filter((li) => byClass(li, 'jl__badge').length > 0);
    const colours = [rgbHex(layers.LEG1), rgbHex(layers.LEG2)];
    expect(items.map((li) => [
      readText(byClass(li, 'jl__badge')[0]), readText(byClass(li, 'jl__name')[0]),
      byClass(li, 'jl__badge')[0].attrs.style.toUpperCase(),
    ])).toEqual(plan.legs.map((leg, i) => [['A', 'B'][i], `${['A', 'B'][i]} · ${nameOf(s, leg.employeeId)}`, `BACKGROUND:${colours[i]}`]));
    // The step symbols keep the leg colour classes.
    const tones = all(s.right, (n) => hasClass(n, 'jt-step__n')).map((n) => n.attrs.class.match(/jt-step__n--(leg\d)/)?.[1]);
    expect(tones).toEqual(plan.legs.flatMap((leg, i) => leg.stops.map(() => `leg${i + 1}`)));
    // #699: no map legend of its own in journey mode; the journey legend keys the map's symbols.
    expect(all(s.mapRegion, (n) => n.attrs['aria-label'] === 'Map legend')).toEqual([]);
    const symbols = byClass(legend, 'jl__item--symbol').map((li) => readText(byClass(li, 'jl__label')[0]));
    expect(symbols).toEqual(plan.kind === 'relay'
      ? ['Package waiting at a business', 'Sender', 'Overnight at the relay point', 'Handoff', 'Delivered']
      : ['Package waiting at a business', 'Sender', 'Delivered']);
  });

  it.each(JOURNEYS)('$name: the right panel shows the reward and the delivery time, equal to the formatted plan values (#552)', (s) => {
    const plan = planOf(s);
    const jt = byClass(s.right, 'jt')[0];
    // Delivery time: under the header, from the plan; "Delivered <time>" once the snapshot has it.
    const header = one(jt, (n) => n.tag === 'header', 'journey header');
    expect(readText(byClass(header, 'jt__time--planned')[0])).toBe(`Planned delivery ${formatMin(plan.deliveryMin)}`);
    const delivered = s.sim.snapshot.deliveredAtMin[plan.shipmentId];
    const deliveredLine = byClass(header, 'jt__time--delivered');
    if (delivered === undefined) expect(deliveredLine).toEqual([]);
    else expect(readText(deliveredLine[0])).toBe(`Delivered ${formatMin(delivered)}`);
    // One line per leg: letter badge, "A · <carrier>" (#683), home neighbourhood, extra minutes, reward (the leg's rewardCents as money).
    const home = (employeeId: string) => {
      const homeId = s.map.employees.find((e) => e.id === employeeId)!.homeId;
      return s.map.homes.find((h) => h.id === homeId)!.neighborhood;
    };
    const lines = byClass(jt, 'jt-leg');
    expect(lines.map((li) => elements(li).map(readText))).toEqual(plan.legs.map((leg, i) => [
      ['A', 'B'][i], `${['A', 'B'][i]} · ${nameOf(s, leg.employeeId)}`, `from ${home(leg.employeeId)}`, `+${leg.extraMin} min extra`,
      `${formatCents(leg.rewardCents)} reward`,
    ]));
    // In the right panel, not on the map or in the left panel.
    for (const area of [s.left, s.mapRegion]) expect(readText(area)).not.toMatch(/ reward\b|Planned delivery/);
  });

  it('the sample checks both "Delivered <time>" and its absence', () => {
    expect(byName('direct journey').sim.snapshot.deliveredAtMin['shp-1']).toBe(1074);
    expect(byName('relay journey').sim.snapshot.deliveredAtMin['shp-2']).toBeUndefined();
  });

  it.each(JOURNEYS)('$name: "Back to network" and the one "Play" are enabled buttons; Play is on the map (#831)', (s) => {
    const back = buttonsNamed(s.root, BACK_TO_NETWORK);
    expect(back.length).toBeGreaterThanOrEqual(1);
    expect(buttonsNamed(s.root, BACK_TO_NETWORK, s.right)).toHaveLength(1);
    const play = buttonsNamed(s.root, PLAY_LABEL);
    expect(play).toHaveLength(1);
    expect(buttonsNamed(s.root, PLAY_LABEL, s.mapRegion)).toEqual(play);
    expect(buttonsNamed(s.root, /^(Play|Pause)( journey)?$/, s.right)).toEqual([]); // the journey panel has none of its own
    for (const b of [...back, ...play]) {
      expect(b.attrs.type).toBe('button');
      expect(b.attrs.disabled).toBeUndefined();
    }
  });

  it.each(STATES.filter((s) => s.selection === null))('$name: no "Back to network" in network mode; the one button plays the clock', (s) => {
    expect(buttonsNamed(s.root, BACK_TO_NETWORK)).toEqual([]);
    expect(buttonsNamed(s.root, /^(Play|Pause)$/)).toHaveLength(1);
    expect(buttonsNamed(s.root, /^(Play|Pause)$/, s.mapRegion)).toHaveLength(1);
  });
});

describe('doc wording: "replace hub with relay point" and no "synthetic city"', () => {
  /** Rendered text plus the attribute text a user can see or hear. */
  const userText = (r: Rendered) => [
    textOf(r.root),
    ...all(r.root, () => true).flatMap((n) => ['aria-label', 'title', 'placeholder', 'alt', 'aria-valuetext'].map((a) => n.attrs[a] ?? '')),
  ].join(' \n ');

  it.each([...STATES, ...SELECTED])('$name: no "hub" and no "synthetic"', (s) => {
    const t = userText(s);
    expect(t).not.toMatch(/hub/i);
    expect(t).not.toMatch(/synthetic/i);
  });

  it('the sample really has a relay plan held overnight (the copy is checked where "hub" would show)', () => {
    const relay = byName('relay journey');
    expect(planOf(relay).kind).toBe('relay');
    expect(relay.sim.snapshot.shipmentStatus['shp-2']).toBe('at_hub');
    expect(readText(byClass(relay.right, 'jt__status')[0])).toContain('relay point');
  });
});
