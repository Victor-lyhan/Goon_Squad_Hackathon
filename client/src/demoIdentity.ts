import { useEffect, useState } from 'react';
import type { Business, Employee } from '../../shared/types';
import { getBusinesses, getEmployees } from './api';

export const IDENTITY_KEY = 'relay.demoIdentity';

export type DemoIdentity = { businessId?: string; employeeId?: string };
export type ResolvedIdentity = { businessId: string; employeeId: string } | null;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Reads only the chosen demo identity; never delivery data. */
export function readIdentity(): DemoIdentity {
  try {
    const raw = storage()?.getItem(IDENTITY_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object') return {};
    const o = v as Record<string, unknown>;
    const out: DemoIdentity = {};
    if (typeof o.businessId === 'string') out.businessId = o.businessId;
    if (typeof o.employeeId === 'string') out.employeeId = o.employeeId;
    return out;
  } catch {
    return {};
  }
}

export function writeIdentity(identity: DemoIdentity): void {
  try {
    storage()?.setItem(IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    /* storage unavailable: choice just won't persist */
  }
}

/** Stored IDs if they still exist, else the first business/employee; null if either list is empty. */
export function resolveIdentity(
  stored: DemoIdentity,
  businesses: Pick<Business, 'id'>[],
  employees: Pick<Employee, 'id'>[],
): ResolvedIdentity {
  const business = businesses.find((b) => b.id === stored.businessId) ?? businesses[0];
  const employee = employees.find((e) => e.id === stored.employeeId) ?? employees[0];
  if (!business || !employee) return null;
  return { businessId: business.id, employeeId: employee.id };
}

export type Directory =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; businesses: Business[]; employees: Employee[] };

/** Loads businesses and employees via client/src/api. Pass `initial` to skip loading (tests). */
export function useDirectory(initial?: { businesses: Business[]; employees: Employee[] }): Directory {
  const [dir, setDir] = useState<Directory>(
    initial ? { status: 'ready', ...initial } : { status: 'loading' },
  );
  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    Promise.all([getBusinesses(), getEmployees()])
      .then(([b, e]) => {
        if (!cancelled) setDir({ status: 'ready', businesses: b.businesses, employees: e.employees });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setDir({ status: 'error', message: err instanceof Error ? err.message : 'Could not load accounts' });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return dir;
}

export function portalPaths(resolved: ResolvedIdentity) {
  return {
    business: resolved ? `/business/${encodeURIComponent(resolved.businessId)}` : null,
    employee: resolved ? `/employee/${encodeURIComponent(resolved.employeeId)}` : null,
  };
}
