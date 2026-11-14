import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CommuteEditor } from '../../client/src/components/CommuteEditor';
import { sampleJob } from './jobDetailSample';
import type { Employee, Trip } from '../../shared/types';

const nodes = sampleJob.map.graph.nodes.map((n) => n.id);
const emp = {
  id: 'emp-1', name: 'Ann', businessId: sampleJob.businesses[0].id, homeNodeId: '',
  eveningDepartureMin: 1050, morningDepartureMin: 1905, maxExtraMin: 8,
  availableEvening: true, availableMorning: true, eveningViaNodeIds: [], morningViaNodeIds: [],
} as Employee;
const trip = (direction: 'evening' | 'morning', dur: number): Trip => ({
  id: `t-${direction}`, employeeId: 'emp-1', direction, originNodeId: nodes[0], destinationNodeId: nodes[1],
  departureMin: 1050, baselineNodeIds: nodes.slice(0, 3), baselineDurationMin: dur, baselineDistanceM: 1000,
});
const saved = (ids: string[] = []) => ({ trips: [trip('evening', 12), trip('morning', 65)], rematchedShipmentIds: ids });
const render = (over: Record<string, unknown> = {}) => renderToStaticMarkup(
  <CommuteEditor employee={emp} trips={[]} map={sampleJob.map} businesses={sampleJob.businesses}
    locked={false} onSave={() => {}} {...over} />,
);
const text = (html: string) => html.replace(/<[^>]+>/g, ' ');

describe('commute layout', () => {
  it('shows persisted routes and confirmation after save', () => {
    const html = render({ saved: saved() });
    expect(html).toContain('Saved. Available for matching.');
    expect(html).toContain('Evening route: 12 min');
    expect(html).toContain('Morning route: 1 h 5 min');
    expect(html).not.toContain('waiting package');
  });
  it('mentions rematched packages', () => {
    expect(render({ saved: saved(['a', 'b']) })).toContain('2 waiting packages were matched to your route.');
    expect(render({ saved: saved(['a']) })).toContain('1 waiting package was matched to your route.');
  });
  it('locked disables save and points to the Setup drawer', () => {
    const html = render({ locked: true });
    expect(html).toContain('Start new planning cycle');
    expect(html).toContain('Setup drawer');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^]*Save commute and find jobs/);
  });
  it('renders field errors and no NaN or raw node ids', () => {
    const html = render({ saved: saved(), fieldErrors: { homeNodeId: 'Pick a home' } });
    expect(html).toContain('Pick a home');
    const t = text(html);
    expect(t).not.toContain('NaN');
    expect(t).not.toMatch(/\bn-\d+-\d+\b/);
  });
  it('css: two-column grid at >=900px, sticky save at <=600px', () => {
    const css = readFileSync('client/src/components/employee/CommuteEditor.css', 'utf8');
    expect(css).toMatch(/@media \(min-width: 900px\)[^@]*grid-template-columns: [^;]+ [^;]+;/);
    expect(css).toMatch(/@media \(max-width: 600px\)[^}]*position: sticky; bottom: 0/);
    expect(css).toContain('.commute-editor__save .ui-btn:focus-visible');
  });
});
