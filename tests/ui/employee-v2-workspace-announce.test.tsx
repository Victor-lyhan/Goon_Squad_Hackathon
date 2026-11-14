// @vitest-environment jsdom
// The Employee workspace announces a newly assigned delivery (#633, demo step 4): one hidden polite live
// region that is there from the first render and holds the `job_assigned` sentence of every job with the
// "New" tag, word for word as the API sent it. `newJobIds` comes from the real workspace reducer, driven
// the way the poller drives it, so "first load", "run change" and "tag cleared" are the real cases.
import { readFileSync } from 'node:fs';
import { act, useReducer, type Dispatch } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { EmployeeDashboard } from '../../shared/v2/api';
import type { Notification } from '../../shared/v2/types';
import { EmployeeWorkspace } from '../../client/src/components/employee/v2/EmployeeWorkspace';
import { newJobAnnouncements } from '../../client/src/components/employee/v2/employeeWorkspaceModel';
import {
  employeeWorkspaceReducer, initialWorkspaceState, type WorkspaceAction,
} from '../../client/src/components/employee/v2/live/employeeWorkspaceState';
import { businesses, dashboard, directView, lockedDashboard, relayView } from './employee-v2-workspace-sample';
import { mount } from './kitDom';

const DIRECT = directView.job.id; // plan-shp-001-L0
const RELAY = relayView.job.id; // plan-shp-002-L1

const note = (jobId: string, message: string, createdSeq: number): Notification => ({
  id: `ntf-${jobId}`, audience: 'employee', audienceId: 'emp-001', kind: 'job_assigned',
  shipmentId: 'shp-x', planId: 'plan-x', jobId, message, createdSeq,
});
// The sentences are deliberately not what the page could build from the job: they must be passed through.
const DIRECT_MSG = 'New delivery job: "Fabric swatches". Collect from Acme Studio and deliver to Cafe Luna. Reward $8.00.';
const RELAY_MSG = 'New delivery job: "Print proofs". Collect from Corner Books & deliver to <Acme Studio>. Reward $7.00.';
const directNote = note(DIRECT, DIRECT_MSG, 1);
const relayNote = note(RELAY, RELAY_MSG, 2);

/** First poll: only the direct job (with its notification, as the API sends it on a first load too). */
const first: EmployeeDashboard = { ...dashboard, assigned: [directView], completed: [], notifications: [directNote], version: 3 };
/** A later poll: the relay job has arrived; the API lists notifications newest first. */
const second: EmployeeDashboard = { ...first, assigned: [directView, relayView], notifications: [relayNote, directNote], version: 4 };

type Api = { dispatch: Dispatch<WorkspaceAction> };

/** The workspace with the real reducer; `api.dispatch` stands in for the poller and for "job opened". */
function Harness({ api }: { api: Api }) {
  const [state, dispatch] = useReducer(employeeWorkspaceReducer, initialWorkspaceState);
  api.dispatch = dispatch;
  if (!state.dashboard) return <p>Loading</p>;
  return <EmployeeWorkspace dashboard={state.dashboard} businesses={businesses} newJobIds={state.newJobIds} />;
}

function setup() {
  const api: Api = { dispatch: () => { throw new Error('not mounted'); } };
  const m = mount(<Harness api={api} />);
  const c = m.container;
  const regions = () => [...c.querySelectorAll<HTMLElement>('.ew-announce')];
  return {
    ...m,
    poll: (d: EmployeeDashboard, runId = 'run-1') => act(() => { api.dispatch({ type: 'dashboard', dashboard: d, runId }); }),
    seen: (jobId: string) => act(() => { api.dispatch({ type: 'seen', jobId }); }),
    regions,
    region: () => regions()[0],
    messages: () => [...regions()[0].children].map((el) => el.textContent),
  };
}

describe('EmployeeWorkspace live region for new jobs', () => {
  it('is one hidden polite region, in place and empty on the first load', () => {
    const p = setup();
    p.poll(first);
    expect(p.regions()).toHaveLength(1);
    const region = p.region();
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.classList.contains('ew-sr')).toBe(true);
    // The dashboard already carries a job_assigned notification, but the first load flags nothing (pass 9).
    expect(region.textContent).toBe('');
    expect(region.children).toHaveLength(0);
    // Hidden regions in the workspace: this one only.
    expect(p.container.querySelectorAll('.ew [role="status"].ew-sr')).toHaveLength(1);
  });

  it('holds the API sentence of a job that arrives with a later poll, word for word, in the same element', () => {
    const p = setup();
    p.poll(first);
    const before = p.region();
    p.poll(second);
    expect(p.regions()).toHaveLength(1);
    expect(p.region()).toBe(before); // the region was there before the text arrived, so it is announced
    expect(p.messages()).toStrictEqual([RELAY_MSG]);
    expect(p.region().textContent).toBe(RELAY_MSG);
    // The visual tag and the announcement are about the same job.
    expect(p.container.querySelector(`[data-job-id="${RELAY}"] .ew-new`)).not.toBeNull();
    expect(p.container.querySelector(`[data-job-id="${DIRECT}"] .ew-new`)).toBeNull();
  });

  it('keeps the message over an equal and a later poll without adding a second one', () => {
    const p = setup();
    p.poll(first);
    p.poll(second);
    const sentence = p.region().firstElementChild;
    p.poll(second);
    p.poll({ ...second, version: 5 });
    expect(p.messages()).toStrictEqual([RELAY_MSG]);
    expect(p.region().firstElementChild).toBe(sentence); // same node: nothing for a screen reader to repeat
  });

  it('several new jobs: their messages in the order of the API', () => {
    const p = setup();
    p.poll({ ...first, assigned: [], notifications: [] });
    p.poll(second); // both jobs arrive; the API lists the relay notification first
    expect(p.messages()).toStrictEqual([RELAY_MSG, DIRECT_MSG]);
    p.poll({ ...second, notifications: [directNote, relayNote], version: 5 });
    expect(p.messages()).toStrictEqual([DIRECT_MSG, RELAY_MSG]);
  });

  it('drops the message once the "New" tag of the job is cleared, and keeps the others', () => {
    const p = setup();
    p.poll({ ...first, assigned: [], notifications: [] });
    p.poll(second);
    const region = p.region();
    p.seen(RELAY);
    expect(p.region()).toBe(region);
    expect(p.messages()).toStrictEqual([DIRECT_MSG]);
    p.seen(DIRECT);
    expect(p.region().textContent).toBe('');
    p.poll({ ...second, version: 6 }); // a later poll does not bring it back
    expect(p.region().textContent).toBe('');
    expect(p.regions()).toHaveLength(1);
  });

  it('is empty again after a run change', () => {
    const p = setup();
    p.poll(first);
    p.poll(second);
    expect(p.messages()).toStrictEqual([RELAY_MSG]);
    p.poll({ ...second, version: 1 }, 'run-2');
    expect(p.regions()).toHaveLength(1);
    expect(p.region().textContent).toBe('');
  });

  it('a new job without a job_assigned notification gets the tag and no invented sentence', () => {
    const p = setup();
    p.poll(first);
    p.poll({ ...second, notifications: [directNote] });
    expect(p.container.querySelector(`[data-job-id="${RELAY}"] .ew-new`)).not.toBeNull();
    expect(p.region().textContent).toBe('');
  });
});

describe('EmployeeWorkspace live region, static render', () => {
  const regionsIn = (html: string) => html.match(/<div class="ew-sr ew-announce"[^>]*>.*?<\/div>/g) ?? [];

  it('is rendered empty without newJobIds, with an empty list and in a locked run', () => {
    const empty = '<div class="ew-sr ew-announce" role="status" aria-live="polite" aria-atomic="false"></div>';
    const withNotes = { ...dashboard, notifications: [relayNote, directNote] };
    for (const html of [
      renderToStaticMarkup(<EmployeeWorkspace dashboard={withNotes} businesses={businesses} />),
      renderToStaticMarkup(<EmployeeWorkspace dashboard={withNotes} businesses={businesses} newJobIds={[]} />),
      renderToStaticMarkup(<EmployeeWorkspace dashboard={withNotes} businesses={businesses} newJobIds={new Set()} />),
      renderToStaticMarkup(<EmployeeWorkspace dashboard={{ ...lockedDashboard, notifications: [relayNote] }} businesses={businesses} />),
    ]) {
      expect(regionsIn(html)).toStrictEqual([empty]);
    }
  });

  it('holds one message per new job, for a Set and for an array', () => {
    const withNotes = { ...dashboard, notifications: [relayNote, directNote] };
    for (const ids of [new Set([RELAY]), [RELAY]]) {
      const html = renderToStaticMarkup(<EmployeeWorkspace dashboard={withNotes} businesses={businesses} newJobIds={ids} />);
      const [region, ...more] = regionsIn(html);
      expect(more).toHaveLength(0);
      expect(region).toContain('<p>New delivery job: &quot;Print proofs&quot;. Collect from Corner Books &amp; deliver to &lt;Acme Studio&gt;. Reward $7.00.</p>');
      expect(region).not.toContain('Fabric swatches');
    }
  });
});

describe('newJobAnnouncements', () => {
  const other: Notification = { ...note(RELAY, 'Delivery arranged.', 3), id: 'ntf-other', kind: 'delivery_matched' };
  const noJob: Notification = { ...note(RELAY, 'No job named.', 4), id: 'ntf-nojob', jobId: undefined };
  const d = { ...dashboard, notifications: [noJob, other, relayNote, directNote] };

  it('is empty without new jobs', () => {
    expect(newJobAnnouncements(d, undefined)).toStrictEqual([]);
    expect(newJobAnnouncements(d, [])).toStrictEqual([]);
    expect(newJobAnnouncements(d, new Set())).toStrictEqual([]);
    expect(newJobAnnouncements({ ...d, notifications: [] }, [RELAY])).toStrictEqual([]);
  });

  it('takes only job_assigned notifications whose jobId is new, message untouched, in API order', () => {
    expect(newJobAnnouncements(d, [RELAY])).toStrictEqual([{ id: 'ntf-plan-shp-002-L1', message: RELAY_MSG }]);
    expect(newJobAnnouncements(d, new Set([DIRECT, RELAY])).map((a) => a.message)).toStrictEqual([RELAY_MSG, DIRECT_MSG]);
    // The order is the API's, not the order of newJobIds.
    expect(newJobAnnouncements(d, [DIRECT, RELAY]).map((a) => a.message)).toStrictEqual([RELAY_MSG, DIRECT_MSG]);
    expect(newJobAnnouncements(d, ['plan-shp-009-L0'])).toStrictEqual([]);
  });
});

describe('EmployeeWorkspace.css: the hidden class', () => {
  it('.ew-sr exists and hides its box without display:none (a display:none region is never read)', () => {
    const css = readFileSync('client/src/components/employee/v2/EmployeeWorkspace.css', 'utf8');
    const rule = css.match(/\.ew-sr\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/clip:\s*rect\(0 0 0 0\)/);
    expect(rule).toMatch(/overflow:\s*hidden/);
    expect(rule).not.toMatch(/display:\s*none|visibility:\s*hidden/);
  });
});
