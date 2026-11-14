import { describe, expect, it } from 'vitest';
import {
  needsMapRefetch, newJobNotifications, portalView, saveErrorMessage, saveMessage,
} from '../../client/src/components/employee/employeePortalModel';
import type { Notification } from '../../shared/types';

const ntf = (id: string, kind: Notification['kind'] = 'job_assigned'): Notification => ({
  id, audience: 'employee', audienceId: 'emp-1', kind, shipmentId: 's', planId: 'p', message: 'm', createdSeq: 1,
});

describe('employee portal model', () => {
  it('save message', () => {
    expect(saveMessage({ rematchedShipmentIds: [] })).toBe('Saved. Your commute is available for matching');
    expect(saveMessage({ rematchedShipmentIds: ['a'] })).toContain('1 waiting package matched');
    expect(saveMessage({ rematchedShipmentIds: ['a', 'b'] })).toContain('2 waiting packages matched');
  });
  it('409 shows the API message', () => {
    expect(saveErrorMessage(409, 'Planning is locked')).toBe('Planning is locked');
  });
  it('detects new jobs, seeding silently on first poll', () => {
    const list = [ntf('a'), ntf('b')];
    expect(newJobNotifications(null, list)).toEqual([]);
    expect(newJobNotifications(new Set(['a']), list).map((n) => n.id)).toEqual(['b']);
    expect(newJobNotifications(new Set(['a', 'b']), list)).toEqual([]);
    expect(newJobNotifications(new Set(), [ntf('c', 'delivery_matched')])).toEqual([]);
  });
  it('view state', () => {
    expect(portalView(null, null)).toBe('loading');
    expect(portalView(null, 'x')).toBe('error');
    expect(portalView({ assigned: [], completed: [] } as never, 'x')).toBe('empty');
    expect(portalView({ assigned: [1], completed: [] } as never, null)).toBe('ready');
  });
  it('map refetch rule', () => {
    expect(needsMapRefetch(null, 1, false)).toBe(true);
    expect(needsMapRefetch(5, 6, true)).toBe(false);
    expect(needsMapRefetch(5, 2, true)).toBe(true);
  });
});
