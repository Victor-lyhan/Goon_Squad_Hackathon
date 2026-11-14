// #580: the business inspector's package rows carry reward, extra minutes and the business's role, and the
// employee inspector shows each stop at the time the journey timeline shows it.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MapResponse, SimulatorResponse } from '../../shared/v2/api';
import { BusinessInspector } from '../../client/src/components/sim/v2/inspector/BusinessInspector';
import {
  NO_MATCH_YET, businessInspector, employeeInspector, formatExtraMin, stopTimeMin,
  type PackageRow,
} from '../../client/src/components/sim/v2/inspector/inspectorModel';
import { buildJourney } from '../../client/src/components/sim/v2/journey/journeyModel';
import { formatMin } from '../../client/src/ui/format';
import { BIZ, EMP, makeMap, makeSim } from './sim-v2-inspector-fixture';
import { T, realSim } from './sim-v2-real-helper';

vi.setConfig({ testTimeout: T, hookTimeout: T });

const sim = makeSim();
const map = makeMap();
const noop = () => {};
const handlers = { onSelectPackage: noop, onSelectEmployee: noop, onSelectBusiness: noop, onFocus: noop, onClear: noop };
const textOf = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const TIME = /^(ETA |Delivered )?Day \d+, \d{1,2}:\d{2} (AM|PM)$/;
const MONEY = /^\$\d{1,3}(,\d{3})*\.\d{2}$/;
const MINUTES = /^[+-]\d+ min$/;

function rowOf(businessId: string, shipmentId: string): PackageRow {
  const m = businessInspector(businessId, sim, map)!;
  const row = [...m.sent, ...m.received, ...m.held].find((r) => r.shipmentId === shipmentId);
  if (!row) throw new Error(`${shipmentId} not in ${businessId}`);
  return row;
}

describe('business package rows: role, reward and extra minutes', () => {
  it('a relay package appears for sender, relay business and recipient with the right role and the same numbers', () => {
    const sender = businessInspector(BIZ.sender, sim, map)!;
    const relay = businessInspector(BIZ.relay, sim, map)!;
    const recipient = businessInspector(BIZ.recipient, sim, map)!;
    const inSent = sender.sent.find((r) => r.shipmentId === 'shp-2')!;
    const inHeld = relay.held.find((r) => r.shipmentId === 'shp-2')!;
    const inReceived = recipient.received.find((r) => r.shipmentId === 'shp-2')!;
    expect([inSent.role, inHeld.role, inReceived.role]).toEqual(['Sender', 'Relay point', 'Recipient']);
    // Reward: the two jobs' rewardCents (380 + 520); extra: the two legs' extraMin (4 + 7).
    for (const r of [inSent, inHeld, inReceived]) {
      expect(r.rewardLabel).toBe('$9.00');
      expect(r.extraLabel).toBe('+11 min');
      expect(r.noMatchLabel).toBeNull();
    }
  });

  it('a direct package reads its one leg', () => {
    const r = rowOf(BIZ.sender, 'shp-1');
    expect([r.role, r.rewardLabel, r.extraLabel]).toEqual(['Sender', '$4.50', '+6 min']);
    expect(rowOf(BIZ.recipient, 'shp-1').role).toBe('Recipient');
  });

  it('reads the reward from the jobs, not from anything the client works out', () => {
    const s2: SimulatorResponse = { ...sim, jobs: sim.jobs.map((j) => (j.planId === 'plan-shp-2' ? { ...j, rewardCents: 111 } : j)) };
    const row = businessInspector(BIZ.relay, s2, map)!.held[0];
    expect(row.rewardLabel).toBe('$2.22');
  });

  it('an unmatched package says "No match yet" and shows no money or minutes', () => {
    const r = rowOf(BIZ.recipient, 'shp-3');
    expect(r).toMatchObject({ role: 'Sender', noMatchLabel: NO_MATCH_YET, rewardLabel: null, extraLabel: null });
    expect(rowOf(BIZ.sender, 'shp-3').role).toBe('Recipient');

    const html = renderToStaticMarkup(<BusinessInspector model={businessInspector(BIZ.recipient, sim, map)} {...handlers} />);
    const row = html.slice(html.indexOf('data-testid="insp-row-shp-3"'), html.indexOf('</li>', html.indexOf('data-testid="insp-row-shp-3"')));
    expect(textOf(row)).toContain('Sender No match yet');
    expect(row).not.toMatch(/\$|\bmin\b|Reward|Extra/);
  });

  it('renders role, reward and extra next to kind, status and ETA, with time and money in mono', () => {
    const html = renderToStaticMarkup(<BusinessInspector model={businessInspector(BIZ.relay, sim, map)} {...handlers} />);
    const t = textOf(html);
    expect(t).toContain('Author galleys Relay · At relay point · ETA Day 2, 8:12 AM Relay point Reward $9.00 Extra +11 min');
    expect(html).toContain('<span class="insp-mono">ETA Day 2, 8:12 AM</span>');
    expect(html).toContain('<span class="insp-mono">$9.00</span>');
    expect(html).toContain('<span class="insp-mono">+11 min</span>');
    expect(html).toContain('<span class="insp-row-role">Relay point</span>');
  });

  it('formats extra minutes with a sign, a negative one as it is', () => {
    expect(formatExtraMin(6)).toBe('+6 min');
    expect(formatExtraMin(0)).toBe('+0 min');
    expect(formatExtraMin(-3)).toBe('-3 min');
    expect(formatExtraMin(Number.NaN)).toBe('+0 min');
  });
});

/** For every job of every employee: the inspector's stop times equal the journey steps of that leg. */
function expectSameStopTimes(s: SimulatorResponse, m: MapResponse) {
  let checked = 0;
  for (const e of m.employees) {
    const model = employeeInspector(e.id, s, m)!;
    for (const job of s.jobs.filter((j) => j.employeeId === e.id)) {
      const block = model.legs.find((l) => l.jobId === job.id);
      expect(block, job.id).toBeDefined();
      const journey = buildJourney({ shipmentId: job.shipmentId, sim: s, map: m });
      if (journey?.kind !== 'journey') throw new Error(`${job.shipmentId}: no journey`);
      const steps = journey.steps.filter((st) => st.legIndex === job.legIndex);
      expect(steps.length, job.id).toBe(block!.stops.length);
      expect(block!.stops.map((st) => st.timeLabel), job.id).toEqual(steps.map((st) => formatMin(st.timeMin)));
      const leg = s.plans.find((p) => p.id === job.planId)!.legs[job.legIndex];
      expect(leg.stops.map(stopTimeMin), job.id).toEqual(steps.map((st) => st.timeMin));
      checked += 1;
    }
  }
  return checked;
}

describe('one time per stop: employee inspector = journey timeline', () => {
  it('on the sample run', () => {
    expect(expectSameStopTimes(sim, map)).toBe(sim.jobs.length);
    expect(employeeInspector(EMP.maya, sim, map)!.legs[0].stops[0].timeLabel).toBe('Day 1, 5:32 PM');
  });

  it('on the default NYC run, at every moment', () => {
    const real = realSim();
    for (const moment of real.moments) {
      expect(expectSameStopTimes(moment.sim, moment.map)).toBe(moment.sim.jobs.length);
    }
  });
});

describe('the default NYC run reads cleanly in every package row', () => {
  it('times, money and minutes are formatted; no NaN, undefined or raw minute counts', () => {
    const real = realSim();
    let rows = 0;
    for (const { sim: s, map: m } of real.moments) {
      for (const b of m.businesses) {
        const model = businessInspector(b.id, s, m)!;
        for (const r of [...model.sent, ...model.received, ...model.held]) {
          rows += 1;
          if (r.timeLabel !== null) expect(r.timeLabel).toMatch(TIME);
          if (r.noMatchLabel) {
            expect([r.rewardLabel, r.extraLabel]).toEqual([null, null]);
          } else {
            expect(r.rewardLabel).toMatch(MONEY);
            expect(r.extraLabel).toMatch(MINUTES);
          }
          expect(JSON.stringify(r)).not.toMatch(/NaN|undefined/);
        }
        const html = renderToStaticMarkup(<BusinessInspector model={model} {...handlers} />);
        expect(html).not.toMatch(/NaN|undefined|null/);
      }
      for (const e of m.employees) {
        for (const leg of employeeInspector(e.id, s, m)!.legs) {
          for (const st of leg.stops) expect(st.timeLabel).toMatch(TIME);
          expect(leg.rewardLabel).toMatch(MONEY);
          expect(leg.extraLabel).toMatch(MINUTES);
        }
      }
    }
    expect(rows).toBeGreaterThan(0);
  });
});
