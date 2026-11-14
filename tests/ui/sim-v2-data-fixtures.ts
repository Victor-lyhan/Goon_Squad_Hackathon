// Small fakes for the sim-v2-data tests (#380). Only the fields the data layer reads are filled in.
import { ApiRequestError } from '../../client/src/api/v2';
import type { MapResponse, SimulatorResponse } from '../../shared/v2/api';

export function simAt(runId: string, version: number, planIds: string[] = ['plan-1'], timeMin = 1000 + version): SimulatorResponse {
  return {
    runId, version,
    clock: { timeMin, playing: false, speed: 120, phase: 'planning' },
    plans: planIds.map((id) => ({ id })),
    jobs: [], shipments: [], unmatched: [], computeMs: 1, nextEventMin: null,
    snapshot: { runId, version, timeMin },
  } as unknown as SimulatorResponse;
}

export function mapOf(runId: string): MapResponse {
  return { runId, businesses: [], homes: [], employees: [], polylines: [] };
}

export const travel503 = (code: 'travel_data_missing' | 'google_key_missing' | 'google_unavailable', text: string) =>
  new ApiRequestError(503, text, undefined, undefined, code);
export const networkError = () => new ApiRequestError(0, 'fetch failed', undefined, 'network');
export const abortError = () => new ApiRequestError(0, 'Request aborted', undefined, 'abort');
export const httpError = (status: number, text: string) => new ApiRequestError(status, text);
