// #954: the advisor by kind (server/ai/advisor.ts) on a FAKE engine with `matchKinds` and a FAKE Gemini: the best
// direct and the best relay plan as typed are both offered (the relay even when it costs more), plus at most one
// what-if that changes the price or the arrival; a kind with no plan gets a plain note with its reason; Gemini
// only picks and words. No network, no key, no run.
import { describe, expect, it } from 'vitest';
import {
  PRESENT_OPTIONS, TRY_VARIANT, advise, adviseOffline, buildAdvisorPrompt, kindNote, type AdvisorEngine, type KindAnswer,
} from '../../server/ai/advisor';
import { GEMINI_MODELS_URL } from '../../server/ai/gemini';
import type { FetchLike } from '../../server/geo/googleClient';
import type { DeliveryPlan } from '../../shared/v2/types';

const leg = (tripId: string, employeeId: string, extraMin: number) =>
  ({ tripId, employeeId, placeIds: [], stops: [], finishMin: 0, extraMin, extraDistanceM: 1609.344, rewardCents: 300 });

/**
 * Direct (Theo Martin): $7.00, $6.00 with the 18 h window, arrives 1893. Relay via Etsy (Elena Rossi, Reese
 * Green): $10.50 / $9.50, arrives 1972. Ready earlier than 960 makes the direct arrive 30 min earlier.
 * `match` is the matcher's overall pick: the cheaper kind that exists.
 */
function fakeEngine(over: { direct?: string; relay?: string; draft?: AdvisorEngine['draft'] } = {}) {
  const flexWindowMin = 1080;
  const discount = (r: number, d: number) => (d - r >= flexWindowMin ? 100 : 0);
  const kinds = (readyMin: number, deadlineMin: number): Record<'direct' | 'relay', KindAnswer> => ({
    direct: over.direct !== undefined ? { reason: over.direct } : { plan: {
      id: 'pln-x', shipmentId: 'shp-advice', kind: 'direct', deliveryMin: readyMin < 960 ? 1863 : 1893,
      customerPriceCents: 700 - discount(readyMin, deadlineMin), platformContributionCents: 0, legs: [leg('t-direct', 'emp-5', 3)],
    } as DeliveryPlan },
    relay: over.relay !== undefined ? { reason: over.relay } : { plan: {
      id: 'pln-x', shipmentId: 'shp-advice', kind: 'relay', relayBusinessId: 'biz-etsy', deliveryMin: 1972,
      customerPriceCents: 1050 - discount(readyMin, deadlineMin), platformContributionCents: 0,
      legs: [leg('t-ev', 'emp-7', 4), leg('t-mo', 'emp-2', 3)],
    } as DeliveryPlan },
  });
  const engine: AdvisorEngine = {
    draft: over.draft ?? { originBusinessId: 'biz-titan', destinationBusinessId: 'biz-kinship', readyMin: 960, deadlineMin: 2000 },
    clockMin: 930, windowStartMin: 930, windowEndMin: 2160, flexWindowMin,
    matchKinds: kinds,
    match(readyMin, deadlineMin) {
      const k = kinds(readyMin, deadlineMin);
      if ('plan' in k.direct) return k.direct;
      if ('plan' in k.relay) return k.relay;
      return { reason: 'Every matching commute is already carrying a package' };
    },
    employeeName: (id) => ({ 'emp-5': 'Theo Martin', 'emp-7': 'Elena Rossi', 'emp-2': 'Reese Green' })[id] ?? 'A carrier',
    businessName: (id) => ({ 'biz-titan': 'Titan Foods', 'biz-kinship': 'Kinship Coffee', 'biz-etsy': 'Etsy' })[id] ?? null,
  };
  return engine;
}

const rows = (options: { label: string; changes: object; customerPriceCents: number; kind: string }[]) =>
  options.map((o) => [o.label, o.kind, o.changes, o.customerPriceCents]);

describe('offline options by kind', () => {
  it('both kinds feasible: the direct and the relay as typed, the relay although it costs more, then one what-if', () => {
    const answer = adviseOffline(fakeEngine());
    expect(answer.source).toBe('offline');
    expect(rows(answer.options)).toStrictEqual([
      ['Direct with Theo Martin, $7.00', 'direct', {}, 700],
      ['Relay via Etsy, $10.50', 'relay', {}, 1050],
      // Ready 2 h earlier (clamped to the clock, 930): the direct arrives earlier. The discount deliver-by is
      // not tried: one what-if at most.
      ['Ready 30 min earlier', 'direct', { readyMin: 930 }, 700],
    ]);
    expect(answer.note).toBeUndefined();
    expect(answer.options[1]).toMatchObject({
      relayBusinessId: 'biz-etsy', carrierNames: ['Elena Rossi', 'Reese Green'], deliveryMin: 1972, extraMin: 7, extraMiles: 2,
      summary: 'Via Etsy with Elena Rossi and Reese Green, arrives Day 2, 8:52 AM, $10.50.',
    });
  });

  it('a what-if that changes neither price nor arrival is not shown; the next one is tried', () => {
    // At the clock already: no earlier ready time exists, so the discount deliver-by is the what-if.
    const engine = { ...fakeEngine(), clockMin: 960 };
    expect(rows(adviseOffline(engine).options)).toStrictEqual([
      ['Direct with Theo Martin, $7.00', 'direct', {}, 700],
      ['Relay via Etsy, $10.50', 'relay', {}, 1050],
      ['Deliver by Day 2, 10:00 AM', 'direct', { deadlineMin: 2040 }, 600],
    ]);
  });

  it('only direct: the direct option and a note that says why there is no relay', () => {
    const reason = 'Every evening commute from Titan Foods is already carrying a package';
    const answer = adviseOffline({ ...fakeEngine({ relay: reason }), clockMin: 960 });
    expect(rows(answer.options)).toStrictEqual([
      ['Direct with Theo Martin, $7.00', 'direct', {}, 700],
      ['Deliver by Day 2, 10:00 AM', 'direct', { deadlineMin: 2040 }, 600],
    ]);
    expect(answer.note).toBe('No relay: every evening commute from Titan Foods is already carrying a package.');
  });

  it('only relay: the relay option and a note for the direct', () => {
    const answer = adviseOffline({ ...fakeEngine({ direct: 'A direct trip would add more than 8 minutes to a commute' }), clockMin: 960 });
    expect(rows(answer.options).map((r) => r[0])).toStrictEqual(['Relay via Etsy, $10.50', 'Deliver by Day 2, 10:00 AM']);
    expect(answer.note).toBe('No direct: a direct trip would add more than 8 minutes to a commute.');
  });

  it('neither kind as typed: the note of #898 from the matcher, as before', () => {
    const answer = adviseOffline(fakeEngine({ direct: 'x', relay: 'y' }));
    expect(answer).toStrictEqual({ options: [], source: 'offline', note: 'Even with more time, every matching commute is already carrying a package.' });
  });

  it('kindNote: one plain sentence, the reason starting small', () => {
    expect(kindNote('relay', 'A relay would add more than 12 minutes to a commute')).toBe('No relay: a relay would add more than 12 minutes to a commute.');
    expect(kindNote('direct', 'No commute can arrive before the deadline.')).toBe('No direct: no commute can arrive before the deadline.');
  });
});

// ---------- fake Gemini ----------
type Part = Record<string, unknown>;
const call = (name: string, args: unknown): Part => ({ functionCall: { name, args } });

function fakeGemini(turns: Part[][]) {
  const bodies: Record<string, any>[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    if (!url.startsWith(GEMINI_MODELS_URL)) return Promise.reject(new Error('only the fake Gemini'));
    bodies.push(JSON.parse(String(init?.body)));
    const parts = turns[bodies.length - 1];
    if (!parts) return Promise.resolve({ status: 500, text: async () => '{}' });
    const body = { candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }] };
    return Promise.resolve({ status: 200, text: async () => JSON.stringify(body) });
  };
  return { fetchImpl, bodies };
}
const settings = (fetchImpl: FetchLike) => ({ apiKey: 'AQ.FAKE_kinds-key', model: 'gemini-2.5-flash', fetchImpl });

describe('Gemini by kind', () => {
  it('gets both kinds as typed up front (r1 direct, r2 relay); the prompt says each matched one is always shown', async () => {
    const engine = fakeEngine({ relay: 'A relay cannot arrive before the deadline' });
    const gemini = fakeGemini([[call(PRESENT_OPTIONS, { options: [{ resultId: 'r1', label: 'Straight there', summary: 'One driver.' }] })]]);
    const answer = await advise(engine, settings(gemini.fetchImpl));
    expect(answer.source).toBe('gemini');
    expect(rows(answer.options)).toStrictEqual([['Straight there', 'direct', {}, 700]]);
    expect(answer.options[0].summary).toBe('One driver.');
    expect(answer.note).toBe('No relay: a relay cannot arrive before the deadline.');
    const request: string = gemini.bodies[0].contents[0].parts[0].text;
    expect(request).toContain('Best direct plan as typed: {"resultId":"r1"');
    expect(request).toContain('"price":"$7.00"');
    expect(request).toContain('Best relay plan as typed: {"resultId":"r2"');
    expect(request).toContain('"matched":false,"reason":"A relay cannot arrive before the deadline"');
    expect(gemini.bodies[0].systemInstruction.parts[0].text).toBe(buildAdvisorPrompt(engine));
    expect(buildAdvisorPrompt(engine)).toContain('Each one that matched is always shown.');
  });

  it('a kind Gemini leaves out is still shown, in the server\'s words; one what-if at most, and numbers are the engine\'s', async () => {
    const engine = fakeEngine();
    const gemini = fakeGemini([
      [call(TRY_VARIANT, { readyMin: 930 }), call(TRY_VARIANT, { deadlineMin: 2040 })],
      [call(PRESENT_OPTIONS, { options: [
        { resultId: 'r4', label: 'Cheaper with more time', summary: 'Only $1.00!', customerPriceCents: 100 },
        { resultId: 'r3', label: 'Earlier', summary: 'Ready sooner.' },
        { resultId: 'r1', label: 'Direct', summary: 'One driver.' },
      ] })],
    ]);
    const answer = await advise(engine, settings(gemini.fetchImpl));
    expect(answer.source).toBe('gemini');
    expect(rows(answer.options)).toStrictEqual([
      ['Direct', 'direct', {}, 700],
      ['Relay via Etsy, $10.50', 'relay', {}, 1050],   // not picked: shown anyway, with the server's label
      ['Cheaper with more time', 'direct', { deadlineMin: 2040 }, 600],
    ]);
    expect(answer.options[2].summary).toBe('Only $1.00!');   // Gemini's words; the price is the engine's 600
    expect(answer.note).toBeUndefined();
  });

  it('a what-if no better than a kind as typed is dropped', async () => {
    const engine = fakeEngine();
    const gemini = fakeGemini([
      [call(TRY_VARIANT, {})],
      [call(PRESENT_OPTIONS, { options: [{ resultId: 'r3', label: 'Same again', summary: 'S' }, { resultId: 'r2', label: 'Relay', summary: 'Two drivers.' }] })],
    ]);
    const answer = await advise(engine, settings(gemini.fetchImpl));
    expect(rows(answer.options)).toStrictEqual([['Direct with Theo Martin, $7.00', 'direct', {}, 700], ['Relay', 'relay', {}, 1050]]);
  });

  it('picks that name no matched result are an unusable answer: the offline options', async () => {
    const engine = fakeEngine();
    const gemini = fakeGemini([[call(PRESENT_OPTIONS, { options: [{ resultId: 'r9', label: 'Invented', summary: 'Free' }] })]]);
    expect(await advise(engine, settings(gemini.fetchImpl))).toStrictEqual(adviseOffline(engine));
  });
});
