import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import Timeline from '../../client/src/components/Timeline';
import {
  DEFAULT_SCRUB_WINDOW as W, clampSeek, createFrameSeeker, scrubKeyTarget, toScrubLabels, toScrubTicks,
} from '../../client/src/components/sim/timelineModel';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import type { SimEvent } from '../../shared/types';

const run = createInitialRun(loadDefaultScenario());
const { scenario } = run;

describe('scrub keys', () => {
  it('Left/Right 5, PageUp/Down 60, Home/End edges', () => {
    expect(scrubKeyTarget('ArrowRight', 1000, W)).toBe(1005);
    expect(scrubKeyTarget('ArrowLeft', 1000, W)).toBe(995);
    expect(scrubKeyTarget('PageUp', 1000, W)).toBe(1060);
    expect(scrubKeyTarget('PageDown', 1000, W)).toBe(940);
    expect(scrubKeyTarget('Home', 1000, W)).toBe(930);
    expect(scrubKeyTarget('End', 1000, W)).toBe(2160);
  });
  it('clamps, returns null at an edge, for other keys and with modifiers', () => {
    expect(scrubKeyTarget('PageDown', 950, W)).toBe(930);
    expect(scrubKeyTarget('ArrowLeft', 930, W)).toBeNull();
    expect(scrubKeyTarget('End', 2160, W)).toBeNull();
    expect(scrubKeyTarget('a', 1000, W)).toBeNull();
    expect(scrubKeyTarget('ArrowRight', 1000, W, { ctrlKey: true })).toBeNull();
  });
  it('clampSeek keeps integers inside the window', () => {
    expect(clampSeek(-5, W)).toBe(930);
    expect(clampSeek(9999, W)).toBe(2160);
    expect(clampSeek(1000.6, W)).toBe(1001);
    expect(clampSeek(NaN, W)).toBe(930);
  });
});

describe('frame seeker', () => {
  it('sends at most one seek per frame, with the latest value', () => {
    const sent: number[] = [];
    let cb: (() => void) | null = null;
    const s = createFrameSeeker((t) => sent.push(t), (f) => { cb = f; return 1; }, () => { cb = null; });
    s.push(1000); s.push(1001); s.push(1002);
    expect(sent).toEqual([]);
    cb!();
    expect(sent).toEqual([1002]);
    s.push(1003);
    s.now(1010);
    expect(sent).toEqual([1002, 1010]);
    expect(cb).toBeNull();
  });
});

describe('ticks and labels', () => {
  const mk = (i: number, timeMin: number, kind: SimEvent['kind'], shipmentId: string): SimEvent => ({
    id: `e${i}`, timeMin, shipmentId, planId: 'p', jobId: 'j', kind, employeeId: 'x', seq: i,
  });
  it('groups events sharing a minute and names type and package', () => {
    const shipments = [{ id: 's1', label: 'Box' }, { id: 's2', label: 'Envelope' }] as never;
    const ticks = toScrubTicks([mk(0, 1000, 'pickup', 's1'), mk(1, 1000, 'delivered', 's2'), mk(2, 2000, 'hub_pickup', 's1')], shipments, W);
    expect(ticks).toHaveLength(2);
    expect(ticks[0].count).toBe(2);
    expect(ticks[0].title).toContain('Pickup – Box');
    expect(ticks[0].title).toContain('Delivered – Envelope');
  });
  it('labels Day 1, Day 2 and the overnight gap', () => {
    const l = toScrubLabels([mk(0, 1000, 'pickup', 's'), mk(1, 1900, 'delivered', 's')], W);
    expect(l.map((x) => x.text)).toEqual(['Day 1', 'Day 2', 'Overnight']);
  });
});

describe('Timeline scrubber with Demo-city data', () => {
  const html = renderToStaticMarkup(
    <Timeline events={run.events} timeMin={W.simStartMin} shipments={run.scenario.shipments}
      employees={scenario.employees} hubs={scenario.hubs} onControl={vi.fn()} />,
  );
  it('renders a labelled slider, ticks and labels without NaN/undefined', () => {
    expect(html).toContain('aria-label="Timeline scrubber"');
    expect(html).toContain('aria-valuetext="Day 1, 3:30 PM"');
    expect(html).toContain('class="tl-tick"');
    expect(html).toContain('Day 2');
    expect(html).toContain('Overnight');
    expect(html).not.toMatch(/NaN|undefined/);
  });
  it('renders without the scrubber when no onControl is given', () => {
    const plain = renderToStaticMarkup(
      <Timeline events={run.events} timeMin={1000} shipments={scenario.shipments} employees={scenario.employees} hubs={scenario.hubs} />,
    );
    expect(plain).not.toContain('tl-slider');
  });
});
