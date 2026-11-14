import { describe, expect, it } from 'vitest';
import { resolveIdentity } from '../../client/src/demoIdentity';
import type { Business, Employee } from '../../shared/types';

const businesses = [
  { id: 'biz-x', name: 'Xylo Supply', nodeId: 'n1', district: 'd' },
  { id: 'biz-y', name: 'Yarrow Goods', nodeId: 'n2', district: 'd' },
] as Business[];
const employees = [
  { id: 'emp-9', name: 'Ana Ruiz', businessId: 'biz-y' },
  { id: 'emp-8', name: 'Bo Chen', businessId: 'biz-x' },
] as Employee[];

describe('resolveIdentity', () => {
  it('keeps valid stored ids', () => {
    expect(resolveIdentity({ businessId: 'biz-y', employeeId: 'emp-8' }, businesses, employees))
      .toEqual({ businessId: 'biz-y', employeeId: 'emp-8' });
  });
  it('falls back to first entries when stale or missing', () => {
    expect(resolveIdentity({ businessId: 'gone', employeeId: 'gone' }, businesses, employees))
      .toEqual({ businessId: 'biz-x', employeeId: 'emp-9' });
    expect(resolveIdentity({}, businesses, employees)).toEqual({ businessId: 'biz-x', employeeId: 'emp-9' });
  });
  it('returns null for empty lists', () => {
    expect(resolveIdentity({}, [], employees)).toBeNull();
    expect(resolveIdentity({}, businesses, [])).toBeNull();
  });
});
