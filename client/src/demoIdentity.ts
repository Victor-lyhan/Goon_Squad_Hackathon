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
  businesses: { id: string }[],
  employees: { id: string }[],
): ResolvedIdentity {
  const business = businesses.find((b) => b.id === stored.businessId) ?? businesses[0];
  const employee = employees.find((e) => e.id === stored.employeeId) ?? employees[0];
  if (!business || !employee) return null;
  return { businessId: business.id, employeeId: employee.id };
}
