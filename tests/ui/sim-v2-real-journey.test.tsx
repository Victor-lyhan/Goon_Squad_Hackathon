// Package journey mode on the REAL default NYC run (#512): every package of the default run, selected, at five
// moments of the day. A matched package gives a journey on network businesses only (SPEC MVP II rule 5); an
// unmatched one shows the API's reason and no journey; every Play journey is watchable in under 30 s
// (DECISIONS pass 46). No story ID, name or count is pinned (DECISIONS pass 54).
import { describe, expect, it, vi } from 'vitest';
import { simPageView } from '../../client/src/components/sim/v2/compose/simPageView';
import {
  NO_JOURNEY_TEXT, PLAY_IDLE, PLAY_LABEL, journeyWindows, playButtonView,
} from '../../client/src/components/sim/v2/compose/journeyPlay';
import { journeyDurationMs } from '../../client/src/components/sim/v2/motion/journeyPlayback';
import { UNKNOWN_CARRIER, UNKNOWN_PLACE, type Journey } from '../../client/src/components/sim/v2/journey/journeyModel';
import { DEFAULT_LAYERS } from '../../client/src/components/sim/v2/workspaceModel';
import { formatCents, formatClock, formatMin } from '../../client/src/ui/format';
import { CARRIED_WIDTH, COMMUTE_WIDTH, LEG1, LEG2, buildLayerSpecs, type PathSpec, type ScatterSpec, type TextSpec } from '../../client/src/components/map/layers';
import { T, elements, escaped, forbiddenIn, realSim, renderBody, text } from './sim-v2-real-helper';

vi.setConfig({ testTimeout: T, hookTimeout: T });

const real = realSim();
const PLAY_LIMIT_MS = 30_000;

const sorted = (xs: Iterable<string>) => [...xs].sort();

describe.each(real.moments)('every package selected at $name', (moment) => {
  const { sim, map } = moment;
  const businesses = new Map(map.businesses.map((b) => [b.id, b]));
  const homeIds = new Set(map.homes.map((h) => h.id));
  const employees = new Map(map.employees.map((e) => [e.id, e]));
  const reasons = new Map(sim.unmatched.map((u) => [u.shipmentId, u.reason]));

  const cases = sim.shipments.map((s) => {
    const selection = { kind: 'package' as const, id: s.id };
    const view = simPageView({ data: moment.data, selection, layers: DEFAULT_LAYERS });
    const plan = sim.plans.find((p) => p.shipmentId === s.id) ?? null;
    return { s, plan, view, html: renderBody(moment, selection) };
  });
  const matched = cases.filter((c) => c.plan !== null);
  const unmatched = cases.filter((c) => c.plan === null);

  it('the run has packages, and every one is either matched or has a reason', () => {
    expect(cases.length).toBeGreaterThan(0);
    expect(matched.length + unmatched.length).toBe(sim.shipments.length);
    for (const c of unmatched) expect(reasons.has(c.s.id)).toBe(true);
  });

  it('every selected package opens journey mode, named by its label', () => {
    for (const { s, view } of cases) {
      expect(view.view).toBe('ready');
      if (view.view !== 'ready') continue;
      expect(view.mode).toBe('journey');
      expect(view.selectedPackageId).toBe(s.id);
      expect(view.journeyTitle).toBe(s.label.trim());
    }
  });

  it('a matched package: the places are exactly the sender, the recipient, the relay business (relay only) and its carriers\' homes', () => {
    for (const { s, plan, view } of matched) {
      if (view.view !== 'ready' || view.right.kind !== 'journey') throw new Error(`${s.id}: no journey`);
      const j: Journey = view.right.journey;
      const carrierIds = plan!.legs.map((l) => l.employeeId);
      const wantBiz = new Set([s.originBusinessId, s.destinationBusinessId]);
      if (plan!.kind === 'relay') {
        expect(plan!.relayBusinessId).toBeTruthy();
        expect(wantBiz.has(plan!.relayBusinessId!)).toBe(false); // R is any business other than A and B
        wantBiz.add(plan!.relayBusinessId!);
      } else {
        expect(plan!.relayBusinessId ?? null).toBeNull();
      }
      const wantHomes = new Set(carrierIds.map((id) => employees.get(id)?.homeId).filter((h): h is string => !!h));
      expect(wantHomes.size).toBeGreaterThan(0);
      expect(sorted(j.places.filter((p) => p.kind === 'business').map((p) => p.id))).toEqual(sorted(wantBiz));
      expect(sorted(j.places.filter((p) => p.kind === 'home').map((p) => p.id))).toEqual(sorted(wantHomes));
      expect(j.places.length).toBe(wantBiz.size + wantHomes.size);
      // The map draws only this journey: its places, its stop symbols, the package and its carriers.
      expect(view.map.places).toBe(j.places);
      expect(view.map.stops.length).toBe(j.steps.length);
      const moverIds = new Set([s.id, ...carrierIds]);
      for (const m of view.map.movers) expect(moverIds.has(m.id)).toBe(true);
      // Carriers are the plan's leg employees, in leg order, by their real names.
      expect(j.carriers.map((c) => c.employeeId)).toEqual(carrierIds);
      for (const c of j.carriers) {
        expect(c.name).toBe(employees.get(c.employeeId)!.name);
        expect(c.name).not.toBe(UNKNOWN_CARRIER);
      }
      expect(j.planKind).toBe(plan!.kind);
      expect(j.status).toBe(sim.snapshot.shipmentStatus[s.id]);
    }
  });

  it('a matched package: steps numbered in order, times never go back, every step at a network business', () => {
    for (const { s, plan, view } of matched) {
      if (view.view !== 'ready' || view.right.kind !== 'journey') throw new Error(`${s.id}: no journey`);
      const { steps } = view.right.journey;
      const apiStops = plan!.legs.flatMap((l) => l.stops);
      expect(steps.length).toBe(apiStops.length);
      expect(steps.length).toBeGreaterThanOrEqual(2);
      expect(steps.map((st) => st.n)).toEqual(steps.map((_, i) => i + 1));
      expect(steps[0].kind).toBe('pickup');
      expect(steps[steps.length - 1].kind).toBe('delivery');
      expect(steps[0].placeId).toBe(s.originBusinessId);
      expect(steps[steps.length - 1].placeId).toBe(s.destinationBusinessId);
      steps.forEach((st, i) => {
        // Read from the API's stop, never computed.
        expect(st.placeId).toBe(apiStops[i].placeId);
        expect(st.timeMin).toBe(apiStops[i].serviceEndMin);
        expect(st.arrivalMin).toBe(apiStops[i].arrivalMin);
        expect(st.arrivalMin).toBeLessThanOrEqual(st.timeMin);
        if (i > 0) expect(st.arrivalMin).toBeGreaterThanOrEqual(steps[i - 1].timeMin);
        // SPEC MVP II rule 5: pickups, drop-offs and storage only at network businesses, never at homes.
        expect(businesses.has(st.placeId)).toBe(true);
        expect(homeIds.has(st.placeId)).toBe(false);
        expect(st.placeName).toBe(businesses.get(st.placeId)!.name);
        expect(st.placeName).not.toBe(UNKNOWN_PLACE);
        expect(st.lat).toBe(businesses.get(st.placeId)!.lat);
        expect(st.lng).toBe(businesses.get(st.placeId)!.lng);
      });
      // Exactly one "Next" step until the journey is done, and done steps come first.
      const states = steps.map((st) => st.state);
      const firstNotDone = states.findIndex((x) => x !== 'done');
      if (firstNotDone >= 0) {
        expect(states[firstNotDone]).toBe('current');
        expect(states.slice(firstNotDone + 1).every((x) => x === 'upcoming')).toBe(true);
      }
      if (sim.snapshot.shipmentStatus[s.id] === 'delivered') expect(states.every((x) => x === 'done')).toBe(true);
    }
  });

  it('a matched package: the panel shows every step with its time, and the legend names each carrier', () => {
    for (const { s, view, html } of matched) {
      if (view.view !== 'ready' || view.right.kind !== 'journey') throw new Error(`${s.id}: no journey`);
      const j = view.right.journey;
      const stepItems = elements(html, 'li', 'class="jt-step ');
      expect(stepItems.length).toBe(j.steps.length);
      j.steps.forEach((st, i) => {
        const t = text(stepItems[i]);
        expect(t).toContain(`Step ${st.n}:`);
        expect(t).toContain(text(escaped(st.placeName)));
        expect(t).toContain(formatMin(st.timeMin));
        expect(t).toContain(text(escaped(st.carrierName)));
      });
      const legend = elements(html, 'section', 'class="jl"');
      expect(legend.length).toBe(1);
      for (const c of j.carriers) expect(text(legend[0])).toContain(text(escaped(c.name)));
      expect(text(html)).toContain(PLAY_LABEL);
    }
  });

  it('a matched package: the panel shows the delivery time and, per leg, the carrier, home, extra minutes and reward (#552)', () => {
    for (const { s, plan, view, html } of matched) {
      if (view.view !== 'ready' || view.right.kind !== 'journey') throw new Error(`${s.id}: no journey`);
      const j = view.right.journey;
      expect(Number.isFinite(plan!.deliveryMin)).toBe(true);
      expect(j.deliveryMin).toBe(plan!.deliveryMin);
      const header = elements(html, 'header', 'class="jt__header"');
      expect(header.length).toBe(1);
      expect(text(header[0])).toContain(`Planned delivery ${formatMin(plan!.deliveryMin)}`);
      const delivered = sim.snapshot.deliveredAtMin[s.id];
      if (delivered === undefined) {
        expect(j.deliveredAtMin).toBeNull();
        expect(header[0]).not.toContain('jt__time--delivered');
      } else {
        expect(j.deliveredAtMin).toBe(delivered);
        expect(text(header[0])).toContain(`Delivered ${formatMin(delivered)}`);
      }
      const legLines = elements(html, 'li', 'class="jt-leg ');
      expect(legLines.length).toBe(plan!.legs.length);
      plan!.legs.forEach((leg, i) => {
        expect(Number.isFinite(leg.rewardCents)).toBe(true);
        expect(Number.isFinite(leg.extraMin)).toBe(true);
        const t = text(legLines[i]);
        expect(t).toContain(`Leg ${i + 1}`);
        expect(t).toContain(text(escaped(employees.get(leg.employeeId)!.name)));
        expect(t).toContain(text(escaped(`from ${j.carriers[i].homeNeighborhood}`)));
        expect(t).toContain(`+${Math.max(0, Math.round(leg.extraMin))} min extra`);
        expect(t).toContain(`${formatCents(leg.rewardCents)} reward`);
        expect(t).not.toMatch(/\bNaN\b|\bundefined\b|\bnull\b|unavailable/);
      });
      // Each carrier's vehicle (when the snapshot places it) has its leg's tone.
      for (const m of view.map.movers.filter((x) => x.kind === 'vehicle')) {
        const first = j.carriers.find((c) => c.employeeId === m.id)!;
        expect(m.tone).toBe(first.tone);
      }
    }
  });

  it('an unmatched package: no delivery time, no leg line, no reward', () => {
    for (const { html } of unmatched) {
      expect(html).not.toContain('jt__time');
      expect(html).not.toContain('class="jt-leg ');
      expect(text(html)).not.toMatch(/Planned delivery| reward\b/);
    }
  });

  it('a matched package: the Play journey plan is watchable in under 30 s', () => {
    const durations: number[] = [];
    for (const { s, view } of matched) {
      if (view.view !== 'ready' || view.right.kind !== 'journey') throw new Error(`${s.id}: no journey`);
      const windows = journeyWindows(view.right.journey);
      expect(windows.length).toBe(view.right.journey.carriers.length);
      const ms = journeyDurationMs(windows);
      durations.push(ms);
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThan(PLAY_LIMIT_MS);
      expect(playButtonView(view.right.journey, PLAY_IDLE).kind).toBe('play');
    }
    if (moment.timeMin === real.moments[0].timeMin && durations.length > 0) {
      console.log(`[#512] Play journey: longest ${Math.max(...durations) / 1000} s over ${durations.length} matched packages`);
    }
  });

  it('an unmatched package: the unmatched state with the API\'s reason and no journey', () => {
    for (const { s, view, html } of unmatched) {
      if (view.view !== 'ready') throw new Error(`${s.id}: not ready`);
      expect(view.right.kind).toBe('unmatched');
      if (view.right.kind !== 'unmatched') continue;
      expect(view.right.journey.reason).toBe(reasons.get(s.id)!.trim());
      expect(view.map.stops).toEqual([]);
      expect(playButtonView(view.right.journey, PLAY_IDLE).kind).toBe('unavailable');
      const panel = elements(html, 'section', 'aria-label="Package journey"');
      expect(panel.length).toBe(1);
      expect(text(panel[0])).toContain(text(escaped(reasons.get(s.id)!.trim())));
      expect(text(panel[0])).toContain('Unmatched');
      expect(html).not.toContain('class="jt__steps"');
      expect(html).not.toContain('class="jl"');
      expect(text(html)).toContain(NO_JOURNEY_TEXT);
    }
  });

  it('no journey page shows undefined, NaN, null, Invalid or "hub"', () => {
    for (const { s, html } of cases) {
      expect({ id: s.id, words: forbiddenIn(html) }).toEqual({ id: s.id, words: [] });
      expect(text(html)).not.toMatch(/\b(biz|home|shp|plan)-[\w-]+/);
    }
  });
});

// #659 (docs/mvp3.md P1 + P4): one relay of the committed NYC cache, as the judge sees it on the map.
describe('a relay of the committed NYC cache on the map: whole commutes, symbols, letters, package on top', () => {
  const night = real.at(1440);
  const plan = night.sim.plans.find((p) => p.kind === 'relay' && night.sim.snapshot.shipmentStatus[p.shipmentId] === 'at_hub');
  const selection = { kind: 'package' as const, id: plan?.shipmentId ?? '' };
  const viewAt = (moment: typeof night) => {
    const v = simPageView({ data: moment.data, selection, layers: DEFAULT_LAYERS });
    if (v.view !== 'ready' || v.right.kind !== 'journey') throw new Error('expected a journey');
    return { v, j: v.right.journey };
  };
  const biz = (id: string) => night.map.businesses.find((b) => b.id === id)!;
  const person = (id: string) => night.map.employees.find((e) => e.id === id)!.name;

  it('the default run has a package waiting overnight at a relay business', () => {
    expect(plan).toBeTruthy();
    expect(plan!.legs).toHaveLength(2);
  });

  it('sender square, relay diamond, swap "Handed to <B>" and recipient flag, at their businesses', () => {
    const { v } = viewAt(night);
    const shipment = night.sim.shipments.find((x) => x.id === plan!.shipmentId)!;
    const [sender, relay, recipient] = [biz(shipment.originBusinessId), biz(plan!.relayBusinessId!), biz(shipment.destinationBusinessId)];
    expect(v.map.stops.map((st) => [st.symbol, st.label, st.lat, st.lng])).toEqual([
      ['sender', sender.name, sender.lat, sender.lng],
      ['relay', `Overnight · ${relay.name}`, relay.lat, relay.lng],
      ['swap', `Handed to ${person(plan!.legs[1].employeeId)}`, relay.lat, relay.lng],
      ['recipient', `To ${recipient.name}`, recipient.lat, recipient.lng],
    ]);
    // Next afternoon: the flag says when, as a clock time read from the snapshot.
    const later = real.at(2160);
    const delivered = later.sim.snapshot.deliveredAtMin[plan!.shipmentId];
    expect(typeof delivered).toBe('number');
    expect(viewAt(later).v.map.stops.at(-1)!.label).toBe(`Delivered ${formatClock(delivered)}`);
  });

  it('each carrier\'s whole commute is thin in its colour, the carried part thick on top of it; no grey baseline', () => {
    const { v } = viewAt(night);
    expect(v.map.routes.filter((r) => r.kind === 'baseline')).toEqual([]);
    const specs = buildLayerSpecs({ ...v.map });
    const ids = specs.map((x) => x.id);
    expect(ids).not.toContain('routes-baseline');
    expect(ids.indexOf('routes-commute')).toBeLessThan(ids.indexOf('routes-leg'));
    const thin = (specs.find((x) => x.id === 'routes-commute') as PathSpec).data;
    const thick = (specs.find((x) => x.id === 'routes-leg') as PathSpec).data;
    for (const [tone, color] of [['leg1', LEG1], ['leg2', LEG2]] as const) {
      const mine = (r: { id: string }) => v.map.routes.find((x) => x.id === r.id)!.tone === tone;
      const t = thin.filter(mine);
      const k = thick.filter(mine);
      expect(t.length).toBeGreaterThan(0);
      expect(k.length).toBeGreaterThan(0);
      for (const d of [...t, ...k]) expect(d.color).toEqual(color);
      for (const d of t) expect(d.width).toBe(COMMUTE_WIDTH);
      for (const d of k) expect(d.width).toBe(CARRIED_WIDTH);
      // The carried part lies on the whole commute, which is longer.
      const onCommute = new Set(t.flatMap((d) => d.path.map((pt) => pt.join(','))));
      for (const d of k) for (const pt of d.path) expect(onCommute.has(pt.join(','))).toBe(true);
      expect(t.reduce((n, d) => n + d.path.length, 0)).toBeGreaterThan(k.reduce((n, d) => n + d.path.length, 0));
    }
  });

  it('the carriers carry A and B, and the package ring is drawn last, around the relay diamond', () => {
    const { v, j } = viewAt(night);
    const specs = buildLayerSpecs({ ...v.map });
    expect(j.carriers.map((c) => c.letter)).toEqual(['A', 'B']);
    const badges = (specs.find((x) => x.id === 'movers-vehicle-badge') as TextSpec | undefined)?.data ?? [];
    for (const b of badges) expect(b.text).toBe(j.carriers.find((c) => c.employeeId === b.id)!.letter);
    expect(specs.slice(-2).map((x) => x.id)).toEqual(['movers-package-halo', 'movers-package']);
    const ring = (specs.at(-1) as ScatterSpec).data[0];
    const relay = biz(plan!.relayBusinessId!);
    expect(ring.position[0]).toBeCloseTo(relay.lng, 5);
    expect(ring.position[1]).toBeCloseTo(relay.lat, 5);
    const glyphs = (specs.find((x) => x.id === 'stops-symbol') as TextSpec).data.map((d) => d.text);
    expect(glyphs).toEqual(['\u25A0', '\u25C6', '\u21C4', '\u2691']);
  });
});
