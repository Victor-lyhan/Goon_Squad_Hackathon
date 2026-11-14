import { describe, expect, it } from 'vitest';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import {
  actionErrorMessage, createSubmitGuard, formFromShipment, newClientRequestId, toRequest, validate,
} from '../../client/src/components/business/shipmentFormModel';
import { ApiRequestError } from '../../client/src/api';
import type { Shipment } from '../../shared/types';

// These cases ran against the MVP 1 routes (POST/PATCH /api/shipments, POST /match) through the MVP 1 client
// helpers. Both were deleted with the MVP 1 API (#628). What is left is what the cases proved about
// shipmentFormModel, which MVP II still imports: on a stored no-match shipment of the Demo city instead of
// one made over HTTP. The same flow over HTTP on /api/v2 is covered by tests/ui/business-v2-real-newdelivery
// and tests/api/v2-shipment-route-*.
describe('no-match -> Edit request -> Try again -> Duplicate (form model)', () => {
  const { scenario } = createInitialRun(loadDefaultScenario());
  const origin = scenario.businesses[0]!;
  const dest = scenario.businesses[1]!;

  // Ready at sim start + 60 but due one minute later: no commute can make it.
  const stored: Shipment = {
    id: 'shp-nm-1', clientRequestId: 'nm-1', originBusinessId: origin.id, destinationBusinessId: dest.id,
    label: 'Tight contracts', category: 'envelope', description: 'Needs it fast', weightGrams: 700,
    readyMin: scenario.settings.simStartMin + 60, deadlineMin: scenario.settings.simStartMin + 61,
    pickupInstructions: 'Front desk', dropoffInstructions: 'Ask for Sam', createdSeq: 99,
  };

  it('Edit request prefills every field from the stored shipment and builds the PATCH body', () => {
    const form = formFromShipment(stored);
    expect(form).toMatchObject({
      originBusinessId: origin.id, destinationBusinessId: dest.id, label: 'Tight contracts',
      category: 'envelope', description: 'Needs it fast', weightKg: '0.7',
      pickupInstructions: 'Front desk', dropoffInstructions: 'Ask for Sam',
    });
    const day = (m: number) => (m >= 1440 ? 2 : 1);
    expect(form.readyDay).toBe(day(stored.readyMin));
    expect(form.deadlineDay).toBe(day(stored.deadlineMin));
    // Edit: relax the deadline to the end of the sim.
    const edited = { ...form, deadlineDay: 2 as const, deadlineTime: '10:00' };
    expect(validate(edited)).toEqual({});
    // The PATCH body is the request without the create-only fields.
    const { clientRequestId: _c, originBusinessId: _o, ...body } = toRequest(edited, 'ignored');
    expect(body).toMatchObject({
      destinationBusinessId: dest.id, label: 'Tight contracts', weightKg: 0.7, readyMin: stored.readyMin, deadlineMin: 2040,
    });
    expect(body).not.toHaveProperty('clientRequestId');
    expect(body).not.toHaveProperty('originBusinessId');
  });

  it('guard ignores a second call while one is pending (no double submit)', async () => {
    const guard = createSubmitGuard();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const first = guard(async () => { calls++; await gate; return 'a'; });
    const second = await guard(async () => { calls++; return 'b'; });
    expect(second).toBeUndefined();
    release();
    expect(await first).toBe('a');
    expect(calls).toBe(1);
    expect(await guard(async () => 'c')).toBe('c');
  });

  it('a 409 while locked shows the "Start a new planning cycle" message', () => {
    for (const said of ['Locked', 'The run is locked', 'Shipment cannot be changed']) {
      const e = new ApiRequestError(409, said);
      expect(actionErrorMessage(e)).toBe(`${said}. Start a new planning cycle to change deliveries.`);
    }
    // A server sentence that already names the planning cycle is not said twice.
    const named = 'Start a new planning cycle to change deliveries';
    expect(actionErrorMessage(new ApiRequestError(409, named))).toBe(named);
    expect(actionErrorMessage(new ApiRequestError(500, 'Boom'))).toBe('Boom');
  });

  it('Duplicate prefills the same details under a new request id, not a replay', () => {
    const form = formFromShipment(stored);
    const id = newClientRequestId(origin.id);
    expect(id).not.toBe(stored.clientRequestId);
    expect(newClientRequestId(origin.id)).not.toBe(id);
    const dup = toRequest(form, id);
    expect(dup.clientRequestId).toBe(id);
    expect(dup).toMatchObject({
      originBusinessId: stored.originBusinessId, destinationBusinessId: stored.destinationBusinessId,
      label: stored.label, description: stored.description, weightKg: stored.weightGrams / 1000,
      readyMin: stored.readyMin, deadlineMin: stored.deadlineMin,
      pickupInstructions: stored.pickupInstructions, dropoffInstructions: stored.dropoffInstructions,
    });
  });
});
