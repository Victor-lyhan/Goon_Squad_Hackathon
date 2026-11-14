// Helpers for the Employee v2 real-DOM tests (#518). kitDom.ts (p2-a) stays as it is; these add what the
// Employee tests miss: fake-timer steps, a fake address search that records its signals, and sample answers.
import { act } from 'react';
import { vi } from 'vitest';
import type { CommuteResponse, EmployeeDashboard, JobResponse } from '../../shared/v2/api';
import type { PutCommuteRequest } from '../../shared/v2/schemas';
import type { AddressResult } from '../../client/src/components/employee/v2/addressSearchModel';
import { deferred } from './kitDom';
import { dashboard, trips } from './employee-v2-workspace-sample';

/** Every test in these files gets this explicit timeout. */
export const T = 10_000;

/**
 * Fakes only the timer functions the code debounces with. kitDom's flush() waits on a real setTimeout,
 * so files on fake timers use advance() instead.
 */
export function useFakeTimers() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
}

/** Moves fake time by `ms`, runs the promises it settles, then flushes React. */
export async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

/** Runs pending promise callbacks (a fake answer settling) and flushes React, without moving time. */
export async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

export type SearchCall = {
  query: string;
  signal: AbortSignal;
  resolve: (r: AddressResult[]) => void;
  reject: (e: unknown) => void;
};

/**
 * A fake SearchFn: each call stays pending until the test settles it. It ignores its signal on purpose,
 * so a late answer to an aborted request really arrives and the component must drop it.
 */
export function fakeSearch() {
  const calls: SearchCall[] = [];
  const fn = vi.fn((query: string, signal: AbortSignal) => {
    const d = deferred<AddressResult[]>();
    calls.push({ query, signal, resolve: d.resolve, reject: d.reject });
    return d.promise;
  });
  return { fn, calls };
}

/** What the geocode route answers: a street label the browser must never keep, plus neighborhood and point. */
export const HARLEM: AddressResult = { label: '310 W 144th St, New York, NY 10030', neighborhood: 'Harlem', lat: 40.82211, lng: -73.94402 };
export const HAMILTON: AddressResult = { label: '500 W 148th St, New York, NY 10031', neighborhood: 'Hamilton Heights', lat: 40.82772, lng: -73.94701 };
export const INWOOD: AddressResult = { label: '45 Park Terrace E, New York, NY 10034', neighborhood: 'Inwood', lat: 40.86971, lng: -73.91664 };

/** An error shaped like ApiRequestError for a 503 from the geocode route (no Google key on the server). */
export const geocode503 = () => Object.assign(new Error('Google key missing'), { status: 503, code: 'google_key_missing' });

/** The CommuteResponse a server would send back for `req`, built from the sample dashboard. */
export function commuteAnswer(req: PutCommuteRequest, base: EmployeeDashboard = dashboard, rematched: string[] = []): CommuteResponse {
  const home = 'homeId' in req.home
    ? base.home
    : { id: 'home-c-test', neighborhood: req.home.neighborhood, lat: req.home.lat, lng: req.home.lng };
  return {
    employee: {
      ...base.employee,
      businessId: req.businessId, homeId: home.id,
      eveningDepartureMin: req.eveningDepartureMin, morningDepartureMin: req.morningDepartureMin,
      availableEvening: req.availableEvening, availableMorning: req.availableMorning, maxExtraMin: req.maxExtraMin,
    },
    home,
    trips: base.trips,
    rematchedShipmentIds: rematched,
  };
}

/** The sample dashboard after a save, as the next poll delivers it. */
export function dashboardAfter(res: CommuteResponse, version: number, base: EmployeeDashboard = dashboard): EmployeeDashboard {
  return { ...base, employee: res.employee, home: res.home, trips: res.trips, version };
}

/** The JobResponse for one of the sample dashboard's jobs. */
export function jobResponseFor(view: EmployeeDashboard['assigned'][number]): JobResponse {
  return { ...view, trip: trips.find((t) => t.id === view.job.tripId)! };
}
