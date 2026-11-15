// #851 (human feedback): in a package journey only the carriers move, and only while they handle the
// package. Relay: carrier A on its evening commute (work → pickup → relay point → home) and carrier B on
// the next morning's commute (home → relay point → delivery → work). Direct: that carrier's one commute.
// No marker for A the next morning, none for B the evening before, none for anybody else, even when the
// snapshot places them (they drive another package then). The route lines are those commutes only.
// Day/night, the overnight card and the handoff and delivered symbols stay.
//
// Three parts: the model on the hand-built sample, the page view (what the map is given), and the REAL
// default NYC run, where carriers do drive other packages. Nothing about the real run is pinned (pass 54).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimulatorResponse } from '../../shared/v2/api';
import type { SimControlRequest } from '../../shared/v2/schemas';
import type { MarkerPosition, Trip } from '../../shared/v2/types';
import { buildLayerSpecs, type ScatterSpec } from '../../client/src/components/map/layers';
import {
  createJourneyPlayer, journeyWindows, type PlayState,
} from '../../client/src/components/sim/v2/compose/journeyPlay';
import { simPageView, type SimReadyView } from '../../client/src/components/sim/v2/compose/simPageView';
import { buildJourney, playPlan, type Journey } from '../../client/src/components/sim/v2/journey/journeyModel';
import { INITIAL_SIM_DATA } from '../../client/src/components/sim/v2/live/simDataModel';
import { JOURNEY_STEP_MS, OVERNIGHT_CARD_MS, nextJourneyAction } from '../../client/src/components/sim/v2/motion/journeyPlayback';
import { DEFAULT_LAYERS } from '../../client/src/components/sim/v2/workspaceModel';
import { watchPackageId } from '../../client/src/pages/landingModel';
import { map, simAt } from './sim-v2-journey-sample';
import { T as REAL_TIMEOUT, realSim, type Moment } from './sim-v2-real-helper';

// ---------- The sample, with the carriers' trips (as the server always sends them) ----------
const trip = (id: string, employeeId: string, direction: Trip['direction'], from: string, to: string, departureMin: number): Trip => ({
  id, employeeId, direction, originPlaceId: from, destinationPlaceId: to, departureMin,
  baselineDurationMin: 30, baselineDistanceM: 8000,
});
// Ana (direct) leaves work at 17:30 and is home at 18:30 (leg finish 1110); Cy (relay A) leaves work at
// 17:20 and is home at 18:20 (1100); Ben (relay B) leaves home at 8:05 and is at work at 8:57 (1977).
const TRIPS = [
  trip('emp-1-eve', 'emp-1', 'evening', 'biz-dumbo', 'home-story-ana', 1050),
  trip('emp-3-eve', 'emp-3', 'evening', 'biz-dumbo', 'home-007', 1040),
  trip('emp-2-morn', 'emp-2', 'morning', 'home-story-ben', 'biz-etsy', 1925),
];
const ANA: MarkerPosition = { employeeId: 'emp-1', lat: 40.7, lng: -73.99, servicing: false };

/**
 * The sample at `timeMin`. Its snapshot places Cy (emp-3), Ben (emp-2) and Dee (emp-9, in no plan of
 * these packages) at EVERY minute, and here Ana (emp-1) too: as if each also drove another package the
 * evening before and the morning after. The journey has to leave those markers out.
 */
function sampleAt(timeMin: number, trips: Trip[] | null = TRIPS): SimulatorResponse {
  const sim = simAt(timeMin);
  return { ...sim, ...(trips ? { trips } : {}), snapshot: { ...sim.snapshot, markers: [...sim.snapshot.markers, ANA] } };
}
const journeyAt = (shipmentId: string, timeMin: number, trips: Trip[] | null = TRIPS) =>
  buildJourney({ shipmentId, sim: sampleAt(timeMin, trips), map }) as Journey;
const vehiclesOf = (j: Journey) => j.movers.filter((m) => m.kind === 'vehicle').map((m) => m.id);
const packagesOf = (j: Journey) => j.movers.filter((m) => m.kind === 'package').map((m) => m.id);

describe('journeyModel: a carrier is on the map only during the commute in which it handles the package (#851)', () => {
  it('the sample snapshot places every carrier at every minute (so the model, not the sample, hides them)', () => {
    for (const t of [1000, 1050, 1500, 1950, 2100]) {
      expect(sampleAt(t).snapshot.markers.map((m) => m.employeeId).sort()).toEqual(['emp-1', 'emp-2', 'emp-3', 'emp-9']);
    }
  });

  it('relay: carrier A from leaving work to arriving home, carrier B from leaving home to arriving at work', () => {
    const at = (t: number) => vehiclesOf(journeyAt('shp-2', t));
    // Day 1, before A sets off: nobody (B is not shown the day before its morning commute).
    expect(at(960)).toEqual([]);
    expect(at(1038)).toEqual([]);
    // A's evening commute: departure 1040, pickup, drop at the relay point 1062, home 1100.
    expect(at(1040)).toEqual(['emp-3']);
    expect(at(1050)).toEqual(['emp-3']);
    expect(at(1062)).toEqual(['emp-3']);
    expect(at(1080)).toEqual(['emp-3']); // after the relay drop, still driving home
    expect(at(1100)).toEqual(['emp-3']); // home
    // The night: nobody.
    expect(at(1101)).toEqual([]);
    expect(at(1500)).toEqual([]);
    expect(at(1923)).toEqual([]);
    // B's morning commute: departure 1925, relay point, delivery 1977 (the end of its commute).
    expect(at(1925)).toEqual(['emp-2']); // A's next morning is not shown
    expect(at(1950)).toEqual(['emp-2']);
    expect(at(1977)).toEqual(['emp-2']);
    // After B arrived: nobody.
    expect(at(1978)).toEqual([]);
    expect(at(2100)).toEqual([]);
  });

  it('the vehicle keeps its leg\'s colour and letter, at the snapshot\'s position', () => {
    const a = journeyAt('shp-2', 1050).movers.find((m) => m.kind === 'vehicle');
    expect(a).toMatchObject({ id: 'emp-3', tone: 'leg1', badge: 'A', label: 'Cy Lam', lat: 40.7035, lng: -73.988 });
    const b = journeyAt('shp-2', 1950).movers.find((m) => m.kind === 'vehicle');
    expect(b).toMatchObject({ id: 'emp-2', tone: 'leg2', badge: 'B', label: 'Ben Okafor', lat: 40.671, lng: -73.9814 });
  });

  it('direct: only that carrier, only on its one commute', () => {
    const at = (t: number) => vehiclesOf(journeyAt('shp-1', t));
    expect(at(1000)).toEqual([]);
    expect(at(1050)).toEqual(['emp-1']);
    expect(at(1072)).toEqual(['emp-1']);
    expect(at(1110)).toEqual(['emp-1']); // home
    expect(at(1111)).toEqual([]);
    expect(at(1950)).toEqual([]); // her next morning is not this package's
  });

  it('an uninvolved employee is never a mover, and the package always is', () => {
    for (let t = 930; t <= 2160; t += 15) {
      for (const id of ['shp-1', 'shp-2']) {
        const j = journeyAt(id, t);
        expect(vehiclesOf(j)).not.toContain('emp-9');
        expect(packagesOf(j)).toEqual([id]);
        // Never more than one carrier at a time: the two commutes are a night apart.
        expect(vehiclesOf(j).length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('the minutes with a vehicle are exactly Play\'s windows', () => {
    for (const id of ['shp-1', 'shp-2']) {
      const j = journeyAt(id, 930);
      const windows = playPlan(j).windows;
      const carrierOfLeg = (legIndex: number) => j.carriers.find((c) => c.legIndex === legIndex)!.employeeId;
      for (let t = 930; t <= 2160; t += 1) {
        const want = windows.filter((w) => t >= w.startMin && t <= w.endMin).map((w) => carrierOfLeg(w.legIndex));
        expect(vehiclesOf(journeyAt(id, t)), `${id} at ${t}`).toEqual(want);
      }
    }
  });

  it('the same person on both legs: on the map in the evening and again in the morning, not in between', () => {
    const at = (t: number) => {
      const sim = sampleAt(t, [...TRIPS, trip('emp-3-morn', 'emp-3', 'morning', 'home-007', 'biz-dumbo', 1925)]);
      const plan = sim.plans.find((p) => p.shipmentId === 'shp-2')!;
      const same = { ...plan, legs: plan.legs.map((l, i) => ({ ...l, employeeId: 'emp-3', tripId: i === 0 ? 'emp-3-eve' : 'emp-3-morn' })) };
      const j = buildJourney({ shipmentId: 'shp-2', sim: { ...sim, plans: sim.plans.map((p) => (p.id === plan.id ? same : p)) }, map }) as Journey;
      return j.movers.filter((m) => m.kind === 'vehicle').map((m) => [m.id, m.badge]);
    };
    expect(at(1050)).toEqual([['emp-3', 'A']]);
    expect(at(1500)).toEqual([]);
    expect(at(1950)).toEqual([['emp-3', 'A']]);
    expect(at(2000)).toEqual([]);
  });

  it('an answer without `trips` (an old sample): the carrier shows around the package, as Play does there', () => {
    const at = (t: number) => vehiclesOf(journeyAt('shp-2', t, null));
    expect(at(1038)).toEqual([]);
    expect(at(1050)).toEqual(['emp-3']);
    expect(at(1062)).toEqual(['emp-3']);
    expect(at(1063)).toEqual([]);
    expect(at(1948)).toEqual([]);
    expect(at(1960)).toEqual(['emp-2']);
    expect(at(1978)).toEqual([]);
  });

  it('a snapshot without a usable minute falls back to the clock\'s', () => {
    const sim = sampleAt(1050);
    const odd = { ...sim, snapshot: { ...sim.snapshot, timeMin: Number.NaN } };
    expect(vehiclesOf(buildJourney({ shipmentId: 'shp-2', sim: odd, map }) as Journey)).toEqual(['emp-3']);
  });
});

describe('journeyModel: the lines are the handling commutes only, the whole journey long (#851)', () => {
  it('relay: every line belongs to A\'s evening trip or B\'s morning trip; they do not come and go with the clock', () => {
    const lines = (t: number) => journeyAt('shp-2', t).routes.map((r) => [r.id, r.tone, r.carried, r.label, r.ownerIds]);
    const first = lines(930);
    for (const t of [1050, 1500, 1950, 2100]) expect(lines(t)).toEqual(first);
    const j = journeyAt('shp-2', 930);
    for (const r of j.routes) {
      expect(r.id).toMatch(/^journey-shp-2-L[01]-/);
      expect(r.ownerIds).toEqual(r.tone === 'leg1' ? ['shp-2', 'plan-shp-2', 'emp-3'] : ['shp-2', 'plan-shp-2', 'emp-2']);
    }
    // The thin whole-commute lines are named after the commute: A's evening, B's morning, nothing else.
    expect(new Set(j.routes.filter((r) => !r.carried).map((r) => r.label))).toEqual(new Set(['Cy Lam · evening', 'Ben Okafor · morning']));
  });

  it('direct: one carrier\'s one commute', () => {
    const j = journeyAt('shp-1', 1500);
    expect(j.routes.length).toBeGreaterThan(0);
    for (const r of j.routes) {
      expect(r.id).toMatch(/^journey-shp-1-L0-/);
      expect(r.tone).toBe('leg1');
      expect(r.ownerIds).toEqual(['shp-1', 'plan-shp-1', 'emp-1']);
    }
    expect(new Set(j.routes.filter((r) => !r.carried).map((r) => r.label))).toEqual(new Set(['Ana Ruiz · evening']));
  });
});

// ---------- The page view: what the map component is given ----------
function pageAt(sim: SimulatorResponse, m = map): SimReadyView {
  const v = simPageView({ data: { ...INITIAL_SIM_DATA, view: 'ready', sim, map: m }, selection: { kind: 'package', id: 'shp-2' }, layers: DEFAULT_LAYERS });
  if (v.view !== 'ready') throw new Error(`expected a ready view, got ${v.view}`);
  return v;
}
const drawnVehicles = (v: SimReadyView) =>
  ((buildLayerSpecs({ ...v.map }).find((s) => s.id === 'movers-vehicle') as ScatterSpec | undefined)?.data ?? []).map((d) => d.id);

describe('the simulator page in a journey: the map gets only the handling carrier (#851)', () => {
  it('evening A, night nobody, morning B; the package, the symbols and day/night stay', () => {
    const cases: [number, string[], 'day' | 'night'][] = [
      [960, [], 'day'], [1050, ['emp-3'], 'night'], [1500, [], 'night'], [1950, ['emp-2'], 'day'], [2100, [], 'day'],
    ];
    for (const [t, want, sky] of cases) {
      const v = pageAt(sampleAt(t));
      expect(v.map.movers.filter((m) => m.kind === 'vehicle').map((m) => m.id), `minute ${t}`).toEqual(want);
      expect(drawnVehicles(v), `minute ${t}`).toEqual(want);
      expect(v.map.movers.filter((m) => m.kind === 'package').map((m) => m.id)).toEqual(['shp-2']);
      expect(v.map.dayNight).toBe(sky);
      // Sender square, Overnight diamond, handoff swap, recipient flag: at every minute.
      expect(v.map.stops.map((s) => s.symbol)).toEqual(['sender', 'relay', 'swap', 'recipient']);
      expect(v.map.stops.map((s) => s.label)).toEqual(['DUMBO Studio', 'Overnight · Brooklyn Roasting', 'Handed to Ben Okafor', 'To Etsy']);
    }
  });

  it('the carried package still rides on its carrier while that carrier is on the map', () => {
    const v = pageAt(sampleAt(1050)); // the sample's marker of emp-3 carries shp-2
    expect(v.map.movers.find((m) => m.id === 'shp-2')?.carrierId).toBe('emp-3');
  });

  it('network Play (no package picked) is unchanged: every marker of the snapshot', () => {
    const sim = sampleAt(1500);
    const v = simPageView({ data: { ...INITIAL_SIM_DATA, view: 'ready', sim, map }, selection: null, layers: DEFAULT_LAYERS });
    if (v.view !== 'ready') throw new Error('expected a ready view');
    expect(v.map.movers.filter((m) => m.kind === 'vehicle').map((m) => m.id).sort()).toEqual(['emp-1', 'emp-2', 'emp-3', 'emp-9']);
  });
});

// ---------- The real default NYC run ----------
describe('the real NYC run: every package journey shows only its handling carriers (#851)', () => {
  const real = realSim();
  const { sim, map: realMap } = real.moments[0];
  const tripOf = new Map(real.run.trips.map((t) => [t.id, t]));
  const moments = new Map<number, Moment>();
  const at = (t: number) => {
    const hit = moments.get(t) ?? real.at(t);
    moments.set(t, hit);
    return hit;
  };
  const journeyOf = (shipmentId: string, m: Moment) => buildJourney({ shipmentId, sim: m.sim, map: realMap }) as Journey;
  const vehicles = (j: Journey) => j.movers.filter((m) => m.kind === 'vehicle').map((m) => m.id);
  /** The commutes in which a carrier handles the plan's package: trip departure to leg finish, from the run. */
  const handlingOf = (shipmentId: string) => sim.plans.find((p) => p.shipmentId === shipmentId)!.legs
    .map((l) => ({ employeeId: l.employeeId, fromMin: tripOf.get(l.tripId)!.departureMin, toMin: l.finishMin }));

  it('at every 5th minute of the run, for every matched package: a vehicle only inside its handling commute, and always there', () => {
    let hidden = 0;
    let shown = 0;
    for (const plan of sim.plans) {
      const handling = handlingOf(plan.shipmentId);
      const carrierIds = new Set(handling.map((h) => h.employeeId));
      for (let t = 930; t <= 2160; t += 5) {
        const m = at(t);
        const on = vehicles(journeyOf(plan.shipmentId, m));
        const want = handling.filter((h) => t >= h.fromMin && t <= h.toMin).map((h) => h.employeeId);
        expect(on, `${plan.shipmentId} at ${t}`).toEqual(want);
        shown += on.length;
        // The server does place this journey's carriers at other minutes (they drive another package):
        // those markers are the ones this issue takes off the journey map.
        hidden += m.sim.snapshot.markers.filter((x) => carrierIds.has(x.employeeId) && !want.includes(x.employeeId)).length;
      }
    }
    expect(shown).toBeGreaterThan(0);
    // Only meaningful while some carrier drives two packages in different commutes; the default run has several.
    const legsOf = new Map<string, number>();
    for (const l of sim.plans.flatMap((p) => p.legs)) legsOf.set(l.employeeId, (legsOf.get(l.employeeId) ?? 0) + 1);
    if ([...legsOf.values()].some((n) => n > 1)) expect(hidden).toBeGreaterThan(0);
    console.log(`[#851] real run: ${sim.plans.length} journeys, ${shown} carrier markers shown, ${hidden} snapshot markers of the same carriers left out`);
  }, REAL_TIMEOUT);

  it('the lines of every journey are its legs\' commutes: one tone per leg, owned by that leg\'s carrier', () => {
    for (const plan of sim.plans) {
      const j = journeyOf(plan.shipmentId, real.moments[0]);
      for (const r of j.routes) {
        const legIndex = r.tone === 'leg1' ? 0 : 1;
        expect(r.id.startsWith(`journey-${plan.shipmentId}-L${legIndex}-`)).toBe(true);
        expect(r.ownerIds).toEqual([plan.shipmentId, plan.id, plan.legs[legIndex].employeeId]);
      }
      expect(new Set(j.routes.map((r) => r.tone)).size).toBeLessThanOrEqual(plan.legs.length);
    }
  }, REAL_TIMEOUT);

  describe('Play on the homepage\'s package with the real player', () => {
    const shipmentId = watchPackageId(sim)!;
    const plan = sim.plans.find((p) => p.shipmentId === shipmentId)!;
    const [legA, legB] = plan.legs;
    const windows = journeyWindows(journeyOf(shipmentId, real.moments[0]));

    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    /** Real milliseconds one press of Play takes, from the windows alone. */
    function realTimeMs(): number {
      let ms = 0;
      let t = -Infinity;
      for (let i = 0; i < 10_000; i += 1) {
        const a = nextJourneyAction(windows, t);
        if (a.kind === 'done') return ms;
        ms += JOURNEY_STEP_MS + (a.overnight ? OVERNIGHT_CARD_MS : 0);
        t = a.toMin;
      }
      throw new Error('the journey never ends');
    }

    it('evening: only A; the overnight card once; morning: only B; night then day; the symbols stay', async () => {
      expect(plan.kind).toBe('relay');
      const seen: { m: Moment; overnightBefore: boolean }[] = [];
      const states: PlayState[] = [];
      let cards = 0;
      const control = vi.fn(async (req: SimControlRequest) => {
        if (req.action !== 'seek') throw new Error(`unexpected control ${req.action}`);
        const m = real.at(req.timeMin);
        seen.push({ m, overnightBefore: cards > 0 });
        return m.sim;
      });
      const player = createJourneyPlayer({
        control,
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
        onChange: (s) => {
          if (s.status === 'running' && s.overnight && !(states[states.length - 1] as { overnight?: boolean } | undefined)?.overnight) cards += 1;
          states.push(s);
        },
      });
      player.start({ shipmentId, runId: sim.runId, windows, fromMin: -Infinity, clockPlaying: false });
      await vi.advanceTimersByTimeAsync(realTimeMs());
      expect(player.state().status).toBe('finished');
      expect(cards).toBe(1); // the overnight skip is still one card

      const evening = seen.filter((s) => !s.overnightBefore);
      const morning = seen.filter((s) => s.overnightBefore);
      expect(evening.length).toBeGreaterThan(3);
      expect(morning.length).toBeGreaterThan(3);
      const page = (m: Moment) => {
        const v = simPageView({ data: m.data, selection: { kind: 'package', id: shipmentId }, layers: DEFAULT_LAYERS });
        if (v.view !== 'ready') throw new Error('expected a ready view');
        return v;
      };
      const onMap = (m: Moment) => page(m).map.movers.filter((x) => x.kind === 'vehicle').map((x) => x.id);

      // Evening: A or nobody (the one step before A's departure), never B, and A on most steps.
      for (const { m } of evening) expect([[], [legA.employeeId]]).toContainEqual(onMap(m));
      expect(evening.filter(({ m }) => onMap(m).length === 1).length).toBeGreaterThanOrEqual(evening.length - 1);
      // Morning: B or nobody, never A, although the snapshot may place A (driving another package).
      for (const { m } of morning) expect([[], [legB.employeeId]]).toContainEqual(onMap(m));
      expect(morning.filter(({ m }) => onMap(m).length === 1).length).toBeGreaterThanOrEqual(morning.length - 1);

      // Day/night as before: the evening commute is dark, the morning commute light.
      for (const { m } of evening) expect(page(m).map.dayNight).toBe('night');
      for (const { m } of morning) expect(page(m).map.dayNight).toBe('day');

      // The symbols stay through the whole journey; the flag reads "Delivered <time>" at the end.
      for (const { m } of seen) expect(page(m).map.stops.map((s) => s.symbol)).toEqual(['sender', 'relay', 'swap', 'recipient']);
      const last = page(seen[seen.length - 1].m);
      expect(last.map.stops[2].label).toMatch(/^Handed to /);
      expect(last.map.stops[3].label).toMatch(/^Delivered \d{1,2}:\d{2} [AP]M$/);
      // The package is on the map at every step.
      for (const { m } of seen) expect(page(m).map.movers.filter((x) => x.kind === 'package').map((x) => x.id)).toEqual([shipmentId]);
    }, REAL_TIMEOUT);
  });
});
