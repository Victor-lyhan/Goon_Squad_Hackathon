// #552: package journey mode, finished. Each carrier's vehicle is drawn in its leg's colour (MapMover.tone),
// the legend shows each carrier with the colour of its vehicle and its route, and the journey panel shows
// the planned delivery time, "Delivered <time>" once the snapshot has it, and one line per leg with the
// carrier, home neighbourhood, extra minutes and reward. Everything is read from the plan and the snapshot.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as L from '../../client/src/components/map/layers';
import type { MapMover } from '../../client/src/components/map/types';
import { JourneyLegend } from '../../client/src/components/sim/v2/journey/JourneyLegend';
import { JourneyTimeline } from '../../client/src/components/sim/v2/journey/JourneyTimeline';
import { buildJourney, type Journey, type UnmatchedJourney } from '../../client/src/components/sim/v2/journey/journeyModel';
import { buildNetworkView } from '../../client/src/components/sim/v2/network/networkModel';
import { formatCents, formatMin } from '../../client/src/ui/format';
import type { SimulatorResponse } from '../../shared/v2/api';
import { T, map, simAt } from './sim-v2-journey-sample';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const noop = () => {};
const hex = (c: L.RGBA) => `#${c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();

const withDelivered = (sim: SimulatorResponse, at: Record<string, number>): SimulatorResponse => ({
  ...sim,
  snapshot: { ...sim.snapshot, deliveredAtMin: at },
});

const relayAt = (t: number) => buildJourney({ shipmentId: 'shp-2', sim: simAt(t), map }) as Journey;
const planOf = (sim: SimulatorResponse, shipmentId: string) => sim.plans.find((p) => p.shipmentId === shipmentId)!;

describe('journeyModel: reward, extra minutes and delivery time come from the plan and the snapshot', () => {
  it('relay: one carrier per leg with its leg\'s extra minutes and reward; planned delivery = plan.deliveryMin', () => {
    const sim = simAt(T.overnight, { 'shp-2': 'at_hub' });
    const j = buildJourney({ shipmentId: 'shp-2', sim, map }) as Journey;
    const plan = planOf(sim, 'shp-2');
    expect(j.carriers.map((c) => [c.employeeId, c.tone, c.extraMin, c.rewardCents])).toEqual(
      plan.legs.map((l, i) => [l.employeeId, i === 0 ? 'leg1' : 'leg2', l.extraMin, l.rewardCents]),
    );
    expect(j.deliveryMin).toBe(plan.deliveryMin);
    expect(j.deliveredAtMin).toBeNull();
  });

  it('deliveredAtMin is the snapshot\'s value once it has one, never computed', () => {
    const sim = withDelivered(simAt(T.afterDelivery, { 'shp-2': 'delivered' }), { 'shp-2': 1979 });
    const j = buildJourney({ shipmentId: 'shp-2', sim, map }) as Journey;
    expect(j.deliveredAtMin).toBe(1979);
    expect(j.deliveryMin).toBe(planOf(sim, 'shp-2').deliveryMin);
    // A snapshot without the field (older server) is not a crash.
    const bare = simAt(T.afterDelivery);
    delete (bare.snapshot as Partial<typeof bare.snapshot>).deliveredAtMin;
    expect((buildJourney({ shipmentId: 'shp-2', sim: bare, map }) as Journey).deliveredAtMin).toBeNull();
  });

  it('vehicles: the first carrier has tone leg1, the second leg2; the package has no tone', () => {
    for (const t of [T.beforePickup, T.onLeg1, T.overnight, T.onLeg2, T.afterDelivery]) {
      const j = relayAt(t);
      const tones = Object.fromEntries(j.movers.map((m) => [m.id, m.tone]));
      const [c1, c2] = j.carriers;
      if (c1.employeeId in tones) expect(tones[c1.employeeId]).toBe('leg1');
      if (c2.employeeId in tones) expect(tones[c2.employeeId]).toBe('leg2');
      for (const m of j.movers.filter((x) => x.kind === 'package')) expect(m.tone).toBeUndefined();
    }
    const both = relayAt(T.onLeg1).movers.filter((m) => m.kind === 'vehicle');
    expect(both.map((m) => m.tone).sort()).toEqual(['leg1', 'leg2']);
  });

  it('the same person on both legs: one vehicle, in the first leg\'s colour and letter', () => {
    const sim = simAt(T.onLeg1);
    const plan = planOf(sim, 'shp-2');
    const same = { ...plan, legs: plan.legs.map((l) => ({ ...l, employeeId: plan.legs[0].employeeId })) };
    const j = buildJourney({ shipmentId: 'shp-2', sim: { ...sim, plans: sim.plans.map((p) => (p.id === plan.id ? same : p)) }, map }) as Journey;
    const vehicles = j.movers.filter((m) => m.kind === 'vehicle');
    expect(vehicles.map((m) => [m.id, m.tone, m.badge])).toEqual([[plan.legs[0].employeeId, 'leg1', 'A']]);
    const html = renderToStaticMarkup(<JourneyLegend carriers={j.carriers} />);
    expect(html).toContain(`background:${L.vehicleLabelColor('leg1')}`);
  });

  it('the network view gives no vehicle a tone (it looks as before)', () => {
    const v = buildNetworkView({ sim: simAt(T.onLeg1), map });
    expect(v.movers.filter((m) => m.kind === 'vehicle').length).toBeGreaterThan(0);
    for (const m of v.movers) expect(m.tone).toBeUndefined();
  });
});

describe('map/layers.ts: a vehicle is drawn in its tone\'s colour', () => {
  const visible = { routes: true, businesses: true, homes: true, packages: true };
  const vehicle = (id: string, tone?: MapMover['tone']): MapMover => ({ id, kind: 'vehicle', lat: 40.7, lng: -73.99, label: id, tone });
  const fills = (movers: MapMover[], selectedIds?: string[]) => {
    const specs = L.buildLayerSpecs({ places: [], routes: [], movers, visible, selectedIds });
    return Object.fromEntries(specs.filter((s) => s.type === 'scatter').flatMap((s) => s.data.map((d) => [`${s.id}:${d.id}`, (d as L.ScatterDatum).fillColor])));
  };

  it('leg1 = LEG1, leg2 = LEG2; no tone = VEHICLE_FILL (the network view)', () => {
    expect(fills([vehicle('a'), vehicle('b', 'leg1'), vehicle('c', 'leg2')])).toEqual({
      'movers-vehicle:a': L.VEHICLE_FILL,
      'movers-vehicle:b': L.LEG1,
      'movers-vehicle:c': L.LEG2,
    });
    expect(L.vehicleColor('leg1')).toBe(L.LEG1);
    expect(L.vehicleColor('leg2')).toBe(L.LEG2);
    expect(L.vehicleColor(undefined)).toBe(L.VEHICLE_FILL);
  });

  it('the leg 1 vehicle has the leg 1 route colour (same RGB), the leg 2 vehicle the leg 2 route colour', () => {
    expect(L.vehicleColor('leg1').slice(0, 3)).toEqual(L.toneColor('leg1').slice(0, 3));
    expect(L.vehicleColor('leg2').slice(0, 3)).toEqual(L.toneColor('leg2').slice(0, 3));
    expect(L.vehicleLabelColor('leg1')).toBe(L.toneLabelColor('leg1'));
    expect(L.vehicleLabelColor('leg2')).toBe(L.toneLabelColor('leg2'));
  });

  it('a toned vehicle outside the selection is dimmed in its own colour', () => {
    const f = fills([vehicle('a', 'leg2'), vehicle('b', 'leg2')], ['b']);
    expect(f['movers-vehicle:a']).toEqual([...L.LEG2.slice(0, 3), L.DIM_ALPHA]);
    expect(f['movers-vehicle-selected:b']).toEqual(L.LEG2);
  });
});

describe('JourneyLegend: each carrier in the colour of its vehicle and its route, with its letter', () => {
  it('relay: badge A = LEG1, badge B = LEG2, both equal to what the map draws for the vehicle and its letter', () => {
    const j = relayAt(T.onLeg1);
    const html = renderToStaticMarkup(<JourneyLegend carriers={j.carriers} />);
    const items = html.split('<li').slice(1, 3);
    const want = [hex(L.LEG1), hex(L.LEG2)];
    items.forEach((li, i) => {
      expect(li).toContain(`jl__badge--leg${i + 1}" aria-hidden="true" style="background:${want[i]}">${'AB'[i]}</span>`);
      expect(text(li)).toContain(`${'AB'[i]} · ${j.carriers[i].name}`);
    });
    // The badge is the colour and the letter the map gives that carrier's vehicle.
    const specs = L.buildLayerSpecs({
      places: [], routes: [], movers: j.movers, visible: { routes: true, businesses: true, homes: true, packages: true },
    });
    const vehicles = specs.find((s) => s.id === 'movers-vehicle')!.data as L.ScatterDatum[];
    const letters = specs.find((s) => s.id === 'movers-vehicle-badge')!.data as L.TextDatum[];
    j.carriers.forEach((c, i) => {
      expect(hex(vehicles.find((d) => d.id === c.employeeId)!.fillColor)).toBe(want[i]);
      expect(letters.find((d) => d.id === c.employeeId)!.text).toBe(c.letter);
    });
  });
});

describe('JourneyTimeline: delivery time and one line per carrier', () => {
  const legLines = (html: string) => (html.match(/<li class="jt-leg [^"]*"[^>]*>.*?<\/li>/g) ?? []).map(text);

  it('relay, not delivered yet: planned delivery under the header, carrier lines A and B, no "Delivered" time', () => {
    const sim = simAt(T.overnight, { 'shp-2': 'at_hub' });
    const plan = planOf(sim, 'shp-2');
    const j = buildJourney({ shipmentId: 'shp-2', sim, map }) as Journey;
    const html = renderToStaticMarkup(<JourneyTimeline journey={j} onSeek={noop} />);
    const header = text(html.match(/<header[\s\S]*?<\/header>/)![0]);
    expect(header).toContain(`Planned delivery ${formatMin(plan.deliveryMin)}`);
    expect(html).not.toContain('jt__time--delivered');
    // The letter badge (hidden from screen readers), then "A · <name>" / "B · <name>"; never "Leg 1" / "Leg 2".
    const letters = ['A', 'B'];
    expect(legLines(html)).toEqual(plan.legs.map((l, i) =>
      `${letters[i]} ${letters[i]} · ${j.carriers[i].name} from ${j.carriers[i].homeNeighborhood} +${l.extraMin} min extra ${formatCents(l.rewardCents)} reward`));
    expect(text(html)).not.toMatch(/\bLeg \d/);
    // Each line's badge and left border are the carrier's map colour (map/layers.ts), as in the legend.
    const items = html.match(/<li class="jt-leg [^>]*>.*?<\/span>/g) ?? [];
    expect(items).toHaveLength(2);
    items.forEach((li, i) => {
      const colour = hex(i === 0 ? L.LEG1 : L.LEG2);
      expect(li).toContain(`style="border-left-color:${colour}"`);
      expect(li).toContain(`jt-badge--leg${i + 1}" aria-hidden="true" style="background:${colour}">${letters[i]}</span>`);
    });
    expect(html).toContain('<ul class="jt__legs" aria-label="Carriers">');
    expect(text(html)).not.toMatch(/NaN|undefined|null|\bhub\b/i);
  });

  it('direct, delivered: "Delivered <time>" from the snapshot, one carrier line: only A', () => {
    const sim = withDelivered(simAt(T.afterDelivery, { 'shp-1': 'delivered' }), { 'shp-1': 1074 });
    const plan = planOf(sim, 'shp-1');
    const j = buildJourney({ shipmentId: 'shp-1', sim, map }) as Journey;
    const html = renderToStaticMarkup(<JourneyTimeline journey={j} onSeek={noop} />);
    const header = text(html.match(/<header[\s\S]*?<\/header>/)![0]);
    expect(header).toContain(`Planned delivery ${formatMin(plan.deliveryMin)}`);
    expect(header).toContain(`Delivered ${formatMin(1074)}`);
    expect(legLines(html)).toHaveLength(1);
    expect(legLines(html)[0]).toContain(`A · ${j.carriers[0].name}`);
    expect(legLines(html)[0]).toContain(`${formatCents(plan.legs[0].rewardCents)} reward`);
    expect(text(html)).not.toMatch(/\bB · |\bLeg \d/);
  });

  it('an unmatched package shows no delivery time, no leg line and no reward', () => {
    const sim = simAt(T.overnight);
    const unmatched: SimulatorResponse = {
      ...sim,
      plans: sim.plans.filter((p) => p.shipmentId !== 'shp-2'),
      unmatched: [{ shipmentId: 'shp-2', reason: 'No commute passes near the sender.' } as SimulatorResponse['unmatched'][number]],
    };
    const j = buildJourney({ shipmentId: 'shp-2', sim: unmatched, map }) as UnmatchedJourney;
    expect(j.kind).toBe('unmatched');
    const html = renderToStaticMarkup(<JourneyTimeline journey={j} onSeek={noop} />);
    expect(html).not.toContain('jt__time');
    expect(html).not.toContain('jt-leg');
    expect(text(html)).not.toMatch(/reward|Planned delivery|\$/);
  });

  it('a non-finite plan value prints a word, never NaN', () => {
    const j = { ...relayAt(T.overnight) };
    j.deliveryMin = Number.NaN;
    j.carriers = j.carriers.map((c) => ({ ...c, rewardCents: Number.NaN, extraMin: Number.NaN }));
    const t = text(renderToStaticMarkup(<JourneyTimeline journey={j} onSeek={noop} />));
    expect(t).toContain('Planned delivery Time unavailable');
    expect(t).toContain('Reward unavailable');
    expect(t).toContain('Extra time unavailable');
    expect(t).not.toMatch(/NaN/);
  });

  it('a leg shorter than the commute shows its real extra minutes, not a floor of zero (#635)', () => {
    const sim = simAt(T.overnight, { 'shp-2': 'at_hub' });
    const shorter: SimulatorResponse = {
      ...sim,
      plans: sim.plans.map((p) => (p.shipmentId === 'shp-2'
        ? { ...p, legs: p.legs.map((l, i) => ({ ...l, extraMin: i === 0 ? -3 : 0 })) }
        : p)),
    };
    const j = buildJourney({ shipmentId: 'shp-2', sim: shorter, map }) as Journey;
    expect(j.carriers.map((c) => c.extraMin)).toEqual([-3, 0]);
    const html = renderToStaticMarkup(<JourneyTimeline journey={j} onSeek={noop} />);
    const lines = legLines(html);
    expect(lines[0]).toContain(`${j.carriers[0].name} from ${j.carriers[0].homeNeighborhood} -3 min extra`);
    expect(lines[1]).toContain(`${j.carriers[1].name} from ${j.carriers[1].homeNeighborhood} +0 min extra`);
    // The steps of leg 1 say the same value as its carrier line.
    const steps = (html.match(/<span class="jt-step__meta">.*?<\/span><\/span>/g) ?? []).map(text);
    expect(steps.map((s) => s.split(' ').slice(-3).join(' '))).toEqual(
      j.steps.map((s) => (s.legIndex === 0 ? '-3 min extra' : '+0 min extra')),
    );
  });
});
