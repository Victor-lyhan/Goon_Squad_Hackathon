// #780 (docs/mvp4.md F2, DECISIONS pass 80): the end-to-end check of the moving employees on the REAL default
// NYC run, through what the map draws: every polled minute goes through `simPageView` (the page's view) and
// `buildLayerSpecs` (the deck.gl layers), with the server views answering (sim-v2-real-helper `at`).
//
// - Network Play (no package picked) across the Day 1 evening and the Day 2 morning: every carrier on a plan
//   leg is a big lettered marker at its trip's origin when it departs and at its trip's destination at
//   `finishMin`; the package rides on it as a badge exactly between its pickup and its drop; a relay package
//   waits at the relay business with "Overnight" through the night; a delivered package has the flag; no
//   background commuter is ever drawn as a mover. Played at the real pace (#790: seeks, like a journey), every
//   carrier is drawn in at least 3 steps of its commute and the whole network plays in at most 60 s.
// - Journeys: the Navy Yard relay (the homepage's package) and one direct evening journey, played with the
//   real journey player and fake timers: start, carry, the overnight skip, the delivery, and each carrier
//   reaching the other end of its commute. The direct evening journey's step line says the carrier is heading
//   home after the delivery, and "Journey complete" only once the button reads Play again.
//
// No ID, name or minute is written here (pass 54): everything is read from the run.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimControlRequest } from '../../shared/v2/schemas';
import type { DeliveryPlan, LatLng, Leg, Trip } from '../../shared/v2/types';
import { NYC_ZOOM } from '../../client/src/components/map/mapStyle';
import {
  OVERNIGHT_TEXT, VEHICLE_RADIUS, WAITING_GLYPH, buildLayerSpecs, offsetByPx, PACKAGE_BADGE_OFFSET,
  type LayerSpec, type ScatterDatum, type TextDatum,
} from '../../client/src/components/map/layers';
import {
  SIM_END_MIN, firstNameInitial, simPageView, type SimReadyView,
} from '../../client/src/components/sim/v2/compose/simPageView';
import {
  NETWORK_STEP_MIN, PAUSE_LABEL, PLAY_LABEL, createJourneyPlayer, journeyWindows, networkWindows, playButtonView,
  playStatusText,
} from '../../client/src/components/sim/v2/compose/journeyPlay';
import { buildJourney, type Journey } from '../../client/src/components/sim/v2/journey/journeyModel';
import { journeyEndMin, JOURNEY_STEP_MIN, JOURNEY_STEP_MS } from '../../client/src/components/sim/v2/motion/journeyPlayback';
import { DEFAULT_LAYERS } from '../../client/src/components/sim/v2/workspaceModel';
import { watchPackageId } from '../../client/src/pages/landingModel';
import { T, metersBetween, realSim, type Moment } from './sim-v2-real-helper';

vi.setConfig({ testTimeout: T, hookTimeout: T });

const real = realSim();
const { sim, map } = real.moments[0];
const trips = new Map(real.run.trips.map((t) => [t.id, t]));
const tripOf = (leg: Leg): Trip => trips.get(leg.tripId)!;

const place = (id: string): LatLng => {
  const p = map.businesses.find((b) => b.id === id) ?? map.homes.find((h) => h.id === id);
  if (!p) throw new Error(`no place ${id} in the map answer`);
  return { lat: p.lat, lng: p.lng };
};
/** A route line starts on the road next to its place, not on the place's own point. */
const NEAR_M = 300;
const at1m = (a: { lat: number; lng: number }, b: LatLng) => metersBetween(a, b) < 1;
const lngLatOf = (d: { position: [number, number] }) => ({ lng: d.position[0], lat: d.position[1] });

// ---------- What the map draws at one moment ----------
type Drawn = {
  view: SimReadyView;
  specs: LayerSpec[];
  vehicles: ScatterDatum[];
  letters: TextDatum[];
  badges: ScatterDatum[];
  waitingGlyphs: TextDatum[];
  waitingLabels: TextDatum[];
  stopLabels: TextDatum[];
  rings: ScatterDatum[];
};

function drawn(m: Moment, selection: { kind: 'package'; id: string } | null = null): Drawn {
  const view = simPageView({ data: m.data, selection, layers: DEFAULT_LAYERS });
  if (view.view !== 'ready') throw new Error(`no ready view at ${m.timeMin}`);
  const specs = buildLayerSpecs({ ...view.map, zoom: NYC_ZOOM });
  const data = <D>(id: string) => (specs.find((s) => s.id === id)?.data ?? []) as D[];
  return {
    view,
    specs,
    vehicles: data<ScatterDatum>('movers-vehicle'),
    letters: data<TextDatum>('movers-vehicle-badge'),
    badges: data<ScatterDatum>('movers-package-badge'),
    waitingGlyphs: data<TextDatum>('movers-package-waiting'),
    waitingLabels: data<TextDatum>('movers-package-label'),
    stopLabels: data<TextDatum>('stops-label'),
    rings: data<ScatterDatum>('movers-package'),
  };
}

// ---------- The plan legs of the run ----------
type Carried = { plan: DeliveryPlan; leg: Leg; legIndex: number; trip: Trip };
const legs: Carried[] = sim.plans.flatMap((plan) => plan.legs.map((leg, legIndex) => ({ plan, leg, legIndex, trip: tripOf(leg) })));
const carrierIds = new Set(legs.map((l) => l.leg.employeeId));
const nameOf = (employeeId: string) => map.employees.find((e) => e.id === employeeId)?.name;

// ---------- Network Play: every minute of both commute periods, and the night every 30 min ----------
const span = (direction: Trip['direction']) => {
  const ls = legs.filter((l) => l.trip.direction === direction);
  return [Math.min(...ls.map((l) => l.trip.departureMin)) - 1, Math.max(...ls.map((l) => l.leg.finishMin)) + 1] as const;
};
const [eveFrom, eveTo] = span('evening');
const [mornFrom, mornTo] = span('morning');
const minutes = new Set<number>();
for (let t = eveFrom; t <= eveTo; t += 1) minutes.add(t);
for (let t = mornFrom; t <= mornTo; t += 1) minutes.add(t);
for (let t = eveTo; t < mornFrom; t += 30) minutes.add(t);
const frames = new Map<number, Drawn>([...minutes].sort((a, b) => a - b).map((t) => [t, drawn(real.at(t))]));
const frame = (t: number) => frames.get(t) ?? drawn(real.at(t));

describe('network Play on the real run: the employees are the movers (#780)', () => {
  it('the run has evening and morning carriers, and relay and direct packages', () => {
    expect(legs.some((l) => l.trip.direction === 'evening')).toBe(true);
    expect(legs.some((l) => l.trip.direction === 'morning')).toBe(true);
    expect(sim.plans.some((p) => p.kind === 'relay')).toBe(true);
    expect(sim.plans.some((p) => p.kind === 'direct')).toBe(true);
    expect(map.employees.length).toBeGreaterThan(carrierIds.size); // there are background commuters
    expect(eveTo).toBeLessThan(mornFrom);
  });

  it('only carriers on a plan leg are drawn as movers, each big and lettered with its first-name initial', () => {
    let drawnVehicles = 0;
    for (const [t, d] of frames) {
      for (const v of d.vehicles) {
        expect(carrierIds.has(v.id), `${v.id} drawn at minute ${t} is not on a plan leg`).toBe(true);
        expect(v.radius).toBe(VEHICLE_RADIUS);
        const letter = d.letters.find((x) => x.id === v.id);
        expect(letter?.text).toBe(firstNameInitial(nameOf(v.id)));
        expect(letter?.position).toEqual(v.position);
      }
      // A vehicle is on the map exactly while one of its legs runs (departure to finish).
      const active = new Set(legs.filter((l) => t >= l.trip.departureMin && t <= l.leg.finishMin).map((l) => l.leg.employeeId));
      expect(new Set(d.vehicles.map((v) => v.id))).toEqual(active);
      drawnVehicles += d.vehicles.length;
    }
    expect(drawnVehicles).toBeGreaterThan(0);
  });

  it('every carrier sets off from its trip\'s origin and is at its trip\'s destination at finishMin', () => {
    for (const { leg, trip } of legs) {
      const who = `${leg.employeeId} on ${trip.id}`;
      const start = frame(trip.departureMin).vehicles.find((v) => v.id === leg.employeeId);
      expect(start, `${who} at departure`).toBeDefined();
      expect(metersBetween(lngLatOf(start!), place(trip.originPlaceId)), `${who} at departure`).toBeLessThanOrEqual(NEAR_M);
      // Morning from home, evening from work: homes are only where commutes start and end.
      const emp = map.employees.find((e) => e.id === leg.employeeId)!;
      expect(trip.originPlaceId).toBe(trip.direction === 'morning' ? emp.homeId : emp.businessId);
      expect(trip.destinationPlaceId).toBe(trip.direction === 'morning' ? emp.businessId : emp.homeId);

      const end = frame(leg.finishMin).vehicles.find((v) => v.id === leg.employeeId);
      expect(end, `${who} at finishMin`).toBeDefined();
      expect(at1m(lngLatOf(end!), place(trip.destinationPlaceId)), `${who} at finishMin`).toBe(true);
      // Then the commute is over and the carrier leaves the map (parked at the other end).
      expect(frame(leg.finishMin + 1).vehicles.some((v) => v.id === leg.employeeId)).toBe(false);
    }
  });

  it('the package rides on its carrier as a badge exactly from the pickup\'s end to the drop\'s end', () => {
    for (const [t, d] of frames) {
      const riding = new Map(d.badges.map((b) => [b.id, b]));
      for (const { plan, leg } of legs) {
        const [pickup, drop] = [leg.stops[0], leg.stops[leg.stops.length - 1]];
        const carrying = t >= pickup.serviceEndMin && t < drop.serviceEndMin;
        if (!carrying) continue;
        const badge = riding.get(plan.shipmentId);
        expect(badge, `${plan.shipmentId} at minute ${t}`).toBeDefined();
        const v = d.vehicles.find((x) => x.id === leg.employeeId)!;
        const expected = offsetByPx(v.position, PACKAGE_BADGE_OFFSET[0], PACKAGE_BADGE_OFFSET[1], NYC_ZOOM);
        expect(badge!.position[0]).toBeCloseTo(expected[0], 9);
        expect(badge!.position[1]).toBeCloseTo(expected[1], 9);
        expect(badge!.item.role).toBe(`Package · with ${v.item.label}`);
      }
      // No badge outside a carry: every badge belongs to a leg carrying it now.
      for (const id of riding.keys()) {
        expect(legs.some(({ plan, leg }) => plan.shipmentId === id
          && t >= leg.stops[0].serviceEndMin && t < leg.stops[leg.stops.length - 1].serviceEndMin), `${id} at minute ${t}`).toBe(true);
      }
    }
  });

  it('through the night a relay package waits at its relay business with the diamond and "Overnight"', () => {
    const relays = sim.plans.filter((p) => p.kind === 'relay');
    const night = [...frames.keys()].filter((t) => t > eveTo && t < mornFrom);
    expect(night.length).toBeGreaterThan(10);
    for (const t of night) {
      const d = frames.get(t)!;
      expect(d.vehicles).toEqual([]); // nobody drives at night
      for (const plan of relays) {
        const relay = place(plan.relayBusinessId!);
        expect(d.waitingGlyphs.some((g) => g.text === WAITING_GLYPH.overnight && at1m(lngLatOf(g), relay)), `${plan.shipmentId} at ${t}`).toBe(true);
        expect(d.waitingLabels.some((l) => l.text.startsWith(OVERNIGHT_TEXT) && at1m(lngLatOf(l), relay)), `${plan.shipmentId} at ${t}`).toBe(true);
      }
    }
    // One glyph and label per relay business: several packages there read "Overnight · n packages".
    const midnight = frames.get(night[Math.floor(night.length / 2)])!;
    const relayIds = new Set(relays.map((p) => p.relayBusinessId!));
    expect(midnight.waitingGlyphs.filter((g) => g.text === WAITING_GLYPH.overnight)).toHaveLength(relayIds.size);
    expect(midnight.waitingLabels).toHaveLength(relayIds.size);
    const count = (id: string) => relays.filter((p) => p.relayBusinessId === id).length;
    for (const id of relayIds) {
      const label = midnight.waitingLabels.find((l) => at1m(lngLatOf(l), place(id)))!;
      expect(label.text).toBe(count(id) > 1 ? `Overnight · ${count(id)} packages` : 'Overnight');
    }
  });

  it('a relay package has the diamond only between its drop and the next carrier\'s pickup', () => {
    for (const plan of sim.plans.filter((p) => p.kind === 'relay')) {
      const drop = plan.legs[0].stops[plan.legs[0].stops.length - 1];
      const collect = plan.legs[1].stops[0];
      const relay = place(plan.relayBusinessId!);
      const waits = (t: number) => frame(t).view.map.movers.find((m) => m.id === plan.shipmentId)?.waiting;
      expect(waits(drop.serviceEndMin - 1)).toBeUndefined();
      expect(waits(drop.serviceEndMin)).toBe('overnight');
      expect(waits(collect.serviceEndMin - 1)).toBe('overnight');
      expect(waits(collect.serviceEndMin)).toBeUndefined();
      expect(frame(drop.serviceEndMin).waitingGlyphs.some((g) => at1m(lngLatOf(g), relay))).toBe(true);
    }
  });

  it('a delivered package shows the delivered flag at its recipient', () => {
    for (const plan of sim.plans) {
      const last = plan.legs[plan.legs.length - 1];
      const deliver = last.stops[last.stops.length - 1];
      const to = place(deliver.placeId);
      const flagged = (t: number) => frame(t).waitingGlyphs.some((g) => g.text === WAITING_GLYPH.delivered && at1m(lngLatOf(g), to));
      expect(frame(deliver.serviceEndMin - 1).view.map.movers.find((m) => m.id === plan.shipmentId)?.waiting).not.toBe('delivered');
      expect(flagged(deliver.serviceEndMin), plan.shipmentId).toBe(true);
      expect(flagged(SIM_END_MIN), plan.shipmentId).toBe(true);
    }
    // At the end of the run every flag is a delivered package; none is drawn at a home.
    const end = frame(SIM_END_MIN);
    for (const g of end.waitingGlyphs) {
      expect(g.text).toBe(WAITING_GLYPH.delivered);
      expect(map.homes.some((h) => at1m(lngLatOf(g), h))).toBe(false);
    }
  });

  // #790: network Play steps with seeks like a journey (it used to be the server clock at 120 sim-min/s polled
  // every 1 s, so a poll landed every 120 simulated minutes and most carriers were drawn in at most one poll).
  // Played here by the real player with fake timers from Back to start (the run's start minute) to the end, over
  // the real windows and step; every seek is drawn as the map draws it.
  it('network Play: every carrier is drawn in at least 3 seek steps of its commute, and Back to start to the end takes at most 60 s', async () => {
    const windows = networkWindows(sim, SIM_END_MIN);
    const seeks: number[] = [];
    let cards = 0;
    const player = createJourneyPlayer({
      control: async (req: SimControlRequest) => {
        if (req.action !== 'seek') throw new Error(`network Play sent ${req.action}`);
        seeks.push(req.timeMin);
        return {};
      },
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      onChange: (s) => { if (s.status === 'running' && s.overnight) cards += 1; },
    });
    const startedAt = Date.now();
    player.start({ shipmentId: null, runId: sim.runId, windows, fromMin: sim.clock.timeMin, clockPlaying: false });
    for (let guard = 0; guard < 10_000 && player.state().status === 'running'; guard += 1) await vi.advanceTimersByTimeAsync(100);
    const realMs = Date.now() - startedAt;
    expect(player.state().status).toBe('finished');
    expect(seeks[seeks.length - 1]).toBe(SIM_END_MIN);
    expect(cards).toBe(1); // the one night, between the evening and the morning
    // Each step is at most NETWORK_STEP_MIN inside a window; nothing is played twice or backwards.
    for (let i = 1; i < seeks.length; i += 1) expect(seeks[i]).toBeGreaterThan(seeks[i - 1]);

    let worst = Infinity;
    for (const { leg, trip } of legs) {
      const drawnSteps = seeks.filter((t) => t >= trip.departureMin && t <= leg.finishMin
        && frame(t).vehicles.some((v) => v.id === leg.employeeId)).length;
      worst = Math.min(worst, drawnSteps);
    }
    console.log(`[#790] network Play: ${seeks.length} seeks of ${NETWORK_STEP_MIN} sim-min per ${JOURNEY_STEP_MS} ms, `
      + `${(realMs / 1000).toFixed(1)} s from Back to start to the end; the fewest steps drawn in one carrier's commute is ${worst}`);
    expect(worst).toBeGreaterThanOrEqual(3);
    expect(realMs).toBeLessThanOrEqual(60_000);
  });
});

// ---------- Journeys, played by the real journey player ----------

type Line = { t: number; running: boolean; line: string; button: string };
type Played = { moments: Moment[]; beforeCard: number; lines: Line[] };

/**
 * Plays one package's journey with the real player and fake timers; every seek is answered by the real
 * server views. After each change it records the step line and the button as the page shows them.
 */
async function playJourney(shipmentId: string): Promise<Played> {
  const journey = buildJourney({ shipmentId, sim, map }) as Journey;
  const windows = journeyWindows(journey);
  const moments: Moment[] = [];
  const lines: Line[] = [];
  let beforeCard = -1;
  const control = vi.fn(async (req: SimControlRequest) => {
    if (req.action !== 'seek') throw new Error(`unexpected control ${req.action}`);
    const m = real.at(req.timeMin);
    moments.push(m);
    return m.sim;
  });
  const player = createJourneyPlayer({
    control,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    onChange: (s) => { if (s.status === 'running' && s.overnight && beforeCard < 0) beforeCard = moments.length; },
  });
  const record = () => {
    const m = moments[moments.length - 1];
    if (!m) return;
    const j = buildJourney({ shipmentId, sim: m.sim, map }) as Journey;
    const play = player.state();
    lines.push({
      t: m.timeMin,
      running: play.status === 'running',
      line: playStatusText(j, play, m.sim.clock.timeMin),
      button: playButtonView({ packagePicked: true, journey: j, play, clock: m.sim.clock, busy: false, simEndMin: SIM_END_MIN }).label,
    });
  };
  player.start({ shipmentId, runId: sim.runId, windows, fromMin: -Infinity, clockPlaying: false });
  await vi.advanceTimersByTimeAsync(0);
  record();
  for (let guard = 0; guard < 10_000 && player.state().status === 'running'; guard += 1) {
    await vi.advanceTimersByTimeAsync(JOURNEY_STEP_MS / 2);
    record();
  }
  expect(player.state().status).toBe('finished');
  expect(moments[moments.length - 1].timeMin).toBe(journeyEndMin(windows));
  return { moments, beforeCard, lines };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** Checks one played leg on the journey map: start, carry, the end of the commute. */
function checkLeg(shipmentId: string, legIndex: number, played: Moment[]) {
  const plan = sim.plans.find((p) => p.shipmentId === shipmentId)!;
  const leg = plan.legs[legIndex];
  const trip = tripOf(leg);
  const letter = legIndex === 0 ? 'A' : 'B';
  const [pickup, drop] = [leg.stops[0], leg.stops[leg.stops.length - 1]];
  const sel = { kind: 'package' as const, id: shipmentId };
  const inLeg = played.filter((m) => m.timeMin >= trip.departureMin - 1 && m.timeMin <= leg.finishMin);
  expect(inLeg[0].timeMin).toBe(trip.departureMin - 1);
  expect(inLeg[inLeg.length - 1].timeMin).toBe(leg.finishMin);

  // Start: not on the road one minute before; first drawn within one step of the departure, as the big
  // lettered marker at the trip's origin (an evening carrier with its pickup at work is still at work).
  expect(drawn(inLeg[0], sel).vehicles.some((v) => v.id === leg.employeeId)).toBe(false);
  const first = inLeg.find((m) => drawn(m, sel).vehicles.some((v) => v.id === leg.employeeId))!;
  expect(first.timeMin).toBeGreaterThanOrEqual(trip.departureMin);
  expect(first.timeMin).toBeLessThanOrEqual(trip.departureMin + JOURNEY_STEP_MIN);
  const dep = drawn(first, sel);
  const v0 = dep.vehicles.find((v) => v.id === leg.employeeId)!;
  expect(v0.radius).toBe(VEHICLE_RADIUS);
  expect(dep.letters.find((x) => x.id === leg.employeeId)?.text).toBe(letter);
  expect(metersBetween(lngLatOf(v0), place(trip.originPlaceId))).toBeLessThanOrEqual(NEAR_M);
  // From there on the carrier is drawn at every step of its commute.
  expect(inLeg.filter((m) => m.timeMin >= first.timeMin).every((m) => drawn(m, sel).vehicles.some((v) => v.id === leg.employeeId))).toBe(true);

  // Carry: the badge rides on this carrier exactly from the pickup's end to the drop's end.
  let carried = 0;
  for (const m of inLeg) {
    const d = drawn(m, sel);
    const badge = d.badges.find((b) => b.id === shipmentId);
    if (m.timeMin >= pickup.serviceEndMin && m.timeMin < drop.serviceEndMin) {
      carried += 1;
      const v = d.vehicles.find((x) => x.id === leg.employeeId)!;
      const expected = offsetByPx(v.position, PACKAGE_BADGE_OFFSET[0], PACKAGE_BADGE_OFFSET[1], NYC_ZOOM);
      expect(badge?.position[0]).toBeCloseTo(expected[0], 9);
      expect(badge?.position[1]).toBeCloseTo(expected[1], 9);
      expect(d.rings).toEqual([]); // the package is the badge, not a ring of its own
    } else {
      expect(badge, `no badge at ${m.timeMin}`).toBeUndefined();
      expect(d.rings.some((r) => r.id === shipmentId)).toBe(true); // it waits, ringed, at a stop
    }
  }
  expect(carried).toBeGreaterThan(0);

  // The end of the commute: the carrier is at the trip's destination (home in the evening, work in the morning).
  const end = drawn(inLeg[inLeg.length - 1], sel).vehicles.find((v) => v.id === leg.employeeId)!;
  expect(at1m(lngLatOf(end), place(trip.destinationPlaceId))).toBe(true);
}

describe('the Navy Yard relay journey on the real run (#780)', () => {
  const shipmentId = watchPackageId(sim)!;
  const plan = sim.plans.find((p) => p.shipmentId === shipmentId)!;

  it('is a relay: evening carrier A, morning carrier B', () => {
    expect(plan.kind).toBe('relay');
    expect(tripOf(plan.legs[0]).direction).toBe('evening');
    expect(tripOf(plan.legs[1]).direction).toBe('morning');
  });

  it('start, carry and the end of each commute; Overnight at the relay point in place of the night; delivered', async () => {
    const { moments, beforeCard } = await playJourney(shipmentId);
    expect(beforeCard).toBeGreaterThan(0);
    const evening = moments.slice(0, beforeCard);
    const morning = moments.slice(beforeCard);
    checkLeg(shipmentId, 0, evening);
    checkLeg(shipmentId, 1, morning);

    // The overnight skip: no minute of the night is played; at the last evening step the package waits,
    // ringed, at the relay point's diamond with "Overnight · <relay>".
    expect(morning[0].timeMin - evening[evening.length - 1].timeMin).toBeGreaterThan(60);
    const sel = { kind: 'package' as const, id: shipmentId };
    const night = drawn(evening[evening.length - 1], sel);
    const relay = place(plan.relayBusinessId!);
    const relayName = map.businesses.find((b) => b.id === plan.relayBusinessId)!.name;
    expect(night.stopLabels.map((l) => l.text)).toContain(`Overnight · ${relayName}`);
    expect(night.rings.some((r) => r.id === shipmentId && at1m(lngLatOf(r), relay))).toBe(true);

    // Delivered: the flag's label reads "Delivered <time>" and the package is ringed at the recipient.
    const last = drawn(morning[morning.length - 1], sel);
    const deliver = plan.legs[1].stops[plan.legs[1].stops.length - 1];
    expect(last.stopLabels.some((l) => l.text.startsWith('Delivered '))).toBe(true);
    expect(last.rings.some((r) => r.id === shipmentId && at1m(lngLatOf(r), place(deliver.placeId)))).toBe(true);
    // No one but the two carriers is ever drawn.
    for (const m of moments) {
      for (const v of drawn(m, sel).vehicles) expect([plan.legs[0].employeeId, plan.legs[1].employeeId]).toContain(v.id);
    }
  });
});

describe('a direct evening journey on the real run (#780)', () => {
  // The direct evening package whose carrier drives longest after the delivery.
  const direct = sim.plans
    .filter((p) => p.kind === 'direct' && tripOf(p.legs[0]).direction === 'evening')
    .map((p) => ({ p, after: p.legs[0].finishMin - p.legs[0].stops[p.legs[0].stops.length - 1].serviceEndMin }))
    .sort((a, b) => b.after - a.after)[0];
  const plan = direct.p;
  const shipmentId = plan.shipmentId;
  const leg = plan.legs[0];
  const deliver = leg.stops[leg.stops.length - 1];
  const carrier = nameOf(leg.employeeId)!;
  const recipient = map.businesses.find((b) => b.id === deliver.placeId)!.name;

  it('the carrier drives on home for a while after the delivery', () => {
    expect(direct.after).toBeGreaterThanOrEqual(10);
    expect(tripOf(leg).destinationPlaceId).toBe(map.employees.find((e) => e.id === leg.employeeId)!.homeId);
  });

  it('start, carry, delivery and the carrier home at the end; no overnight card', async () => {
    const { moments, beforeCard } = await playJourney(shipmentId);
    expect(beforeCard).toBe(-1);
    checkLeg(shipmentId, 0, moments);
    const sel = { kind: 'package' as const, id: shipmentId };
    const after = moments.filter((m) => m.timeMin >= deliver.serviceEndMin);
    expect(after.length).toBeGreaterThan(2);
    for (const m of after) {
      const d = drawn(m, sel);
      expect(d.stopLabels.some((l) => l.text.startsWith('Delivered '))).toBe(true);
      expect(d.rings.some((r) => r.id === shipmentId && at1m(lngLatOf(r), place(deliver.placeId)))).toBe(true);
    }
    // The carrier moves away from the recipient towards home after the delivery.
    const gap = after.map((m) => metersBetween(lngLatOf(drawn(m, sel).vehicles.find((v) => v.id === leg.employeeId)!), place(deliver.placeId)));
    expect(gap[gap.length - 1]).toBeGreaterThan(NEAR_M);
  });

  it('the step line says the package is delivered and the carrier is heading home, then "Journey complete" only once the button reads Play', async () => {
    const { lines } = await playJourney(shipmentId);
    const delivered = `Delivered to recipient at ${recipient}.`;
    const driving = lines.filter((l) => l.running && l.t >= deliver.serviceEndMin && l.t < leg.finishMin);
    expect(driving.length).toBeGreaterThan(2);
    for (const l of driving) {
      expect(l.line).toBe(`${delivered} ${carrier} is heading home.`);
      expect(l.button).toBe(PAUSE_LABEL);
    }
    // While it plays it never says "Journey complete".
    for (const l of lines.filter((x) => x.running)) expect(l.line.startsWith('Journey complete')).toBe(false);
    // The last step lands at finishMin: home, still playing for one step.
    const home = lines.filter((l) => l.running && l.t === leg.finishMin);
    expect(home.length).toBeGreaterThan(0);
    for (const l of home) expect(l.line).toBe(`${delivered} ${carrier} is home.`);
    // Then the window ends: Play again, and "Journey complete".
    const end = lines[lines.length - 1];
    expect(end.running).toBe(false);
    expect(end.button).toBe(PLAY_LABEL);
    expect(end.line).toBe(`Journey complete: ${delivered.slice(0, -1)}.`);
  });
});
