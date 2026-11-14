import { describe, expect, it } from 'vitest';
import { relayExplanation, stopRows, toJobDetailModel } from '../../client/src/components/employee/jobDetailModel';
import { sampleJob } from './jobDetailSample';

const l = { businesses: sampleJob.businesses, hubs: sampleJob.hubs, nodes: sampleJob.map.graph.nodes };

describe('jobDetailModel', () => {
  it('relayExplanation leg 0', () => {
    expect(relayExplanation(sampleJob.at(0), l)).toBe('Drop at Hub H; another employee completes delivery');
  });
  it('relayExplanation leg 1', () => {
    expect(relayExplanation(sampleJob.at(1), l)).toBe('Collect from Hub H and deliver to Business B');
  });
  it('relayExplanation direct is null', () => {
    expect(relayExplanation(sampleJob.direct(), l)).toBeNull();
  });
  it('stopRows are ordered, named, with instructions and no raw ids', () => {
    const rows = stopRows(sampleJob.at(0), l);
    expect(rows.map((r) => r.kind)).toEqual(['pickup', 'hub_drop']);
    expect(rows.map((r) => r.place)).toEqual(['Business A', 'Hub H']);
    expect(rows[0].instructions).toBe('Ask for desk');
    expect(rows[1].instructions).toBe('');
    expect(JSON.stringify(rows)).not.toMatch(/"(A|H|B)"/);
    const last = stopRows(sampleJob.at(1), l);
    expect(last[1].instructions).toBe('Leave at dock');
  });
  it('falls back to node label then generic', () => {
    const rows = stopRows(sampleJob.at(0), { businesses: [], hubs: [], nodes: l.nodes });
    expect(rows[0].place).toBe('Business A');
    expect(stopRows(sampleJob.at(0), { businesses: [], hubs: [] })[0].place).toBe('Stop');
  });
  it('toJobDetailModel formats', () => {
    const m = toJobDetailModel(sampleJob.at(0), l);
    expect(m.statusLabel).toBe('Assigned');
    expect(m.weight).toBe('0.3 kg');
    expect(m.added).toBe('+6 min');
  });
});
