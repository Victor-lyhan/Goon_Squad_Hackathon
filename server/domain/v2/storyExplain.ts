import type { Employee, Leg, Shipment, Trip } from '../../../shared/v2/types';
import {
  compareCandidates, rankCandidates, scheduleLeg, type MatchContext, type RankableCandidate,
} from './matching';

/** The first rule that ruled an option out.
 * - `unavailable`: a carrier has no commute in the needed direction, or no finite route visits the stops.
 * - `same_carrier`: both relay commutes belong to one employee. The matcher checks it, but an employee
 *   works at one business, so with a distinct sender and recipient no input reaches it.
 * - `detour_limit`: travel and handling alone exceed the carrier's added-time limit.
 * - `not_ready`: the carrier is within the limit, but not after waiting for the package to be ready.
 * - `relay_order`: the morning carrier is within the limit, but not after waiting for the relay drop-off.
 * - `deadline`: the carrier is within the limit, but the drop-off ends after the deadline.
 */
export type ExplainRule = 'detour_limit' | 'not_ready' | 'deadline' | 'relay_order' | 'unavailable' | 'same_carrier';
export type ExplainKind = 'evening_direct' | 'morning_direct' | 'relay';

export type ExplainCarrier = {
  employeeId: string;
  /** Null when the employee has no commute in this direction. */
  tripId: string | null;
  direction: 'evening' | 'morning';
  /** `Leg.placeIds` order: `[A, B, home]`, `[home, A, B]`, `[A, R, home]` or `[home, R, B]`. */
  placeIds: string[];
  /** Added minutes with the limit ignored; null when the commute cannot be scheduled. */
  extraMin: number | null;
  maxExtraMin: number;
  /** Minutes spent waiting at the pickup (for the package, or for the relay drop-off). */
  waitMin: number | null;
};

export type ExplainRow = {
  kind: ExplainKind;
  relayBusinessId?: string;
  /** Every place the carriers visit, in travel order: the carriers' `placeIds` one after the other. */
  placeIds: string[];
  carrierIds: string[];
  /** Travel order: the evening carrier first for a relay. A relay with no commute on one side lists the other only. */
  carriers: ExplainCarrier[];
  /** Pickup service start and delivery service end; null unless every commute can be scheduled. */
  pickupMin: number | null;
  deliveryMin: number | null;
  /** Minutes the delivery ends after the deadline; 0 when on time. */
  lateMin: number | null;
  /** How far the option misses: minutes over each carrier's limit plus minutes late.
   * 0 when feasible; null when no number of minutes would fix it (`unavailable`, `same_carrier`). */
  missMin: number | null;
} & ({ feasible: true } | {
  feasible: false; rule: ExplainRule; reason: string;
  /** Index into `carriers` of the commute that broke the rule, when it is one commute. */
  failedCarrier?: number;
});

type Carrier = { trip: Trip; employee: Employee };
type LegCheck = { carrier: Carrier; placeId: string; leg: Leg | null; rule?: ExplainRule };
type Scheduled = RankableCandidate & { row: ExplainRow };

const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const distinctNeighbours = (places: string[]) => places.filter((place, i) => i === 0 || place !== places[i - 1]);

/** Every option the matcher considers for one delivery request, and why each infeasible one fails.
 *
 * Rows: evening direct for every employee of the sender, morning direct for every employee of the
 * recipient, and for every relay business every feasible pair of carriers, or its nearest miss when
 * no pair is feasible. The feasible rows are exactly `generateCandidates(shipment, ctx)`.
 *
 * Order: options with a schedule in the matcher's allocation order (feasible or not), then the
 * options that have none. So the first feasible row is the plan `assignShipments` gives this request
 * when no other request competes for the trips.
 *
 * Every rule is decided by the matcher's `scheduleLeg`, called with one input relaxed at a time.
 * A missing travel pair throws `TravelDataMissingError`. Returns `[]` when the sender or recipient
 * is unknown or they are the same business; no relay rows when `settings.allowRelay` is off.
 */
export function explainShipment(shipment: Shipment, ctx: MatchContext): ExplainRow[] {
  const origin = ctx.businesses.find(business => business.id === shipment.originBusinessId);
  const destination = ctx.businesses.find(business => business.id === shipment.destinationBusinessId);
  if (!origin || !destination || origin.id === destination.id) return [];
  const employees = new Map(ctx.employees.map(employee => [employee.id, employee]));
  const eligible = (direction: Trip['direction'], businessId: string): Carrier[] => ctx.trips.flatMap(trip => {
    const employee = employees.get(trip.employeeId);
    return trip.direction === direction && employee?.businessId === businessId ? [{ trip, employee }] : [];
  });
  const evenings = eligible('evening', origin.id);
  const mornings = eligible('morning', destination.id);

  /** `baseReadyMin` is the package's own ready time; `readyMin` may also wait for the relay drop-off. */
  const check = (
    carrier: Carrier, placeId: string, pickupKind: 'pickup' | 'hub_pickup', dropKind: 'hub_drop' | 'delivery',
    readyMin: number, baseReadyMin: number,
  ): LegCheck => {
    const { trip, employee } = carrier;
    const run = (who: Employee, ready: number, deadline: number) =>
      scheduleLeg(ctx, trip, who, placeId, pickupKind, dropKind, ready, deadline);
    const strict = run(employee, readyMin, shipment.deadlineMin);
    if (strict) return { carrier, placeId, leg: strict };
    const leg = run({ ...employee, maxExtraMin: Infinity }, readyMin, Infinity);
    if (!leg) return { carrier, placeId, leg, rule: 'unavailable' };
    if (run(employee, readyMin, Infinity)) return { carrier, placeId, leg, rule: 'deadline' };
    if (readyMin > baseReadyMin && run(employee, baseReadyMin, Infinity)) {
      return { carrier, placeId, leg, rule: 'relay_order' };
    }
    if (run(employee, -Infinity, Infinity)) return { carrier, placeId, leg, rule: 'not_ready' };
    return { carrier, placeId, leg, rule: 'detour_limit' };
  };

  const carrierOf = ({ carrier, placeId, leg }: LegCheck): ExplainCarrier => ({
    employeeId: carrier.employee.id, tripId: carrier.trip.id, direction: carrier.trip.direction,
    placeIds: leg?.placeIds ?? distinctNeighbours(
      [carrier.trip.originPlaceId, placeId, carrier.trip.destinationPlaceId]),
    extraMin: leg?.extraMin ?? null, maxExtraMin: carrier.employee.maxExtraMin,
    waitMin: leg ? leg.stops[0].serviceStartMin - leg.stops[0].arrivalMin : null,
  });

  const scheduled: Scheduled[] = [];
  const unscheduled: ExplainRow[] = [];
  /** `structural` is a rule that holds whatever the legs say; otherwise the first leg rule in travel order. */
  const build = (
    kind: ExplainKind, checks: LegCheck[], relayBusinessId?: string,
    structural?: { rule: ExplainRule; reason: string }, extraCarriers: ExplainCarrier[] = [],
  ): { row: ExplainRow; plan: Scheduled | null } => {
    const carriers = [...checks.map(carrierOf), ...extraCarriers];
    const complete = extraCarriers.length === 0 && checks.length === (kind === 'relay' ? 2 : 1)
      && checks.every(c => c.leg);
    const legs = complete ? checks.map(c => c.leg!) : null;
    const deliveryMin = legs ? legs[legs.length - 1].stops[1].serviceEndMin : null;
    const lateMin = deliveryMin === null ? null : Math.max(0, deliveryMin - shipment.deadlineMin);
    const failedCarrier = checks.findIndex(c => c.rule);
    const failed = structural ?? (failedCarrier < 0 ? null : {
      rule: checks[failedCarrier].rule!, failedCarrier,
      reason: legReason(checks[failedCarrier].rule!, checks[failedCarrier].carrier.trip.direction),
    });
    const measurable = legs !== null && !structural;
    const row: ExplainRow = {
      kind, ...(relayBusinessId === undefined ? {} : { relayBusinessId }),
      placeIds: carriers.flatMap(c => c.placeIds), carrierIds: carriers.map(c => c.employeeId), carriers,
      pickupMin: legs ? legs[0].stops[0].serviceStartMin : null, deliveryMin, lateMin,
      missMin: measurable ? lateMin! + carriers.reduce((sum, c) => sum + Math.max(0, c.extraMin! - c.maxExtraMin), 0) : null,
      ...(failed ? { feasible: false, ...failed } : { feasible: true }),
    };
    const plan = legs ? { kind: kind === 'relay' ? 'relay' as const : 'direct' as const, legs,
      deliveryMin: deliveryMin!, ...(relayBusinessId === undefined ? {} : { relayBusinessId }), row } : null;
    return { row, plan };
  };
  const add = ({ row, plan }: { row: ExplainRow; plan: Scheduled | null }) => {
    if (plan) scheduled.push(plan); else unscheduled.push(row);
  };

  // Direct: every commute the matcher tries, then the employees who have none in that direction.
  for (const [direction, kind, carriers, business] of [
    ['evening', 'evening_direct', evenings, origin], ['morning', 'morning_direct', mornings, destination],
  ] as const) {
    for (const carrier of carriers) {
      add(build(kind, [check(carrier, direction === 'evening' ? destination.id : origin.id,
        'pickup', 'delivery', shipment.readyMin, shipment.readyMin)]));
    }
    const sender = direction === 'evening';
    for (const employee of employees.values()) {
      if (employee.businessId !== business.id || carriers.some(c => c.employee.id === employee.id)) continue;
      add(build(kind, [], undefined, { rule: 'unavailable',
        reason: `No ${sender ? 'sender evening' : 'recipient morning'} commute is available for this employee` },
      [{ employeeId: employee.id, tripId: null, direction,
        placeIds: distinctNeighbours(sender ? [origin.id, destination.id, employee.homeId]
          : [employee.homeId, origin.id, destination.id]),
        extraMin: null, maxExtraMin: employee.maxExtraMin, waitMin: null }]));
    }
  }

  if (ctx.settings.allowRelay) {
    const missingSide = evenings.length === 0 && mornings.length === 0
      ? 'No sender evening commute or recipient morning commute is available'
      : evenings.length === 0 ? 'No sender evening commute is available'
        : mornings.length === 0 ? 'No recipient morning commute is available' : null;
    for (const relay of ctx.businesses) {
      if (relay.id === origin.id || relay.id === destination.id) continue;
      const deposits = evenings.map(carrier =>
        check(carrier, relay.id, 'pickup', 'hub_drop', shipment.readyMin, shipment.readyMin));
      const pairs: { row: ExplainRow; plan: Scheduled | null }[] = [];
      for (const deposit of deposits.length ? deposits : [null]) {
        for (const morning of mornings.length ? mornings : [null]) {
          // The relay drop-off is scheduled even when it breaks a rule, so the row shows both carriers.
          const collection = morning && check(morning, relay.id, 'hub_pickup', 'delivery',
            Math.max(shipment.readyMin, deposit?.leg?.stops[1].serviceEndMin ?? -Infinity), shipment.readyMin);
          const checks = [deposit, collection].filter((c): c is LegCheck => c !== null);
          pairs.push(build('relay', checks, relay.id,
            missingSide ? { rule: 'unavailable', reason: missingSide }
              : deposit!.carrier.employee.id === morning!.employee.id
                ? { rule: 'same_carrier', reason: 'The relay would use the same employee for both commutes' }
                : undefined));
        }
      }
      const feasible = pairs.filter(pair => pair.row.feasible);
      if (feasible.length) feasible.forEach(add);
      else add(nearestMiss(pairs, ctx));
    }
  }

  return [
    ...rankCandidates(scheduled.sort(compareCandidates), ctx.settings).map(option => option.row),
    ...unscheduled.sort((a, b) => compareText(unscheduledKey(a), unscheduledKey(b))),
  ];
}

function legReason(rule: ExplainRule, direction: Trip['direction']): string {
  switch (rule) {
    case 'detour_limit': return `The ${direction} route would exceed the employee's added-time limit`;
    case 'not_ready': return `The ${direction} commute is not available after the package is ready: `
      + "waiting for it would exceed the employee's added-time limit";
    case 'relay_order': return 'The morning commute reaches the relay point before the package is dropped off there: '
      + "waiting for it would exceed the employee's added-time limit";
    case 'deadline': return `The ${direction} commute cannot arrive before the deadline`;
    default: return 'No available commute route can visit the required pickup and drop-off stops';
  }
}

const unscheduledKey = (row: ExplainRow) => [row.kind, row.relayBusinessId ?? '',
  ...row.carriers.map(c => `${c.direction}:${c.tripId ?? ''}:${c.employeeId}`)].join('|');

/** The pair of carriers that misses by the fewest minutes; ties in the matcher's order. */
function nearestMiss(
  pairs: { row: ExplainRow; plan: Scheduled | null }[], ctx: MatchContext,
): { row: ExplainRow; plan: Scheduled | null } {
  const measured = pairs.flatMap(pair => pair.plan && pair.row.missMin !== null ? [pair.plan] : []);
  if (measured.length) {
    const best = rankCandidates(measured.sort(compareCandidates), ctx.settings)
      .reduce((a, b) => b.row.missMin! < a.row.missMin! ? b : a);
    return { row: best.row, plan: best };
  }
  return [...pairs].sort((a, b) => Number(b.plan !== null) - Number(a.plan !== null)
    || compareText(unscheduledKey(a.row), unscheduledKey(b.row)))[0];
}

const clock = (min: number) => `Day ${Math.floor(min / 1440) + 1} `
  + `${String(Math.floor(min % 1440 / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const signed = (min: number) => `${min >= 0 ? '+' : ''}${min}`;

/** Plain terminal lines: up to `limit` feasible rows in the given (matcher) order, then up to
 * `limit` ruled-out rows, nearest miss first. `names` maps business and employee IDs to display
 * names; an ID without a name is printed as it is.
 */
export function formatExplain(
  rows: readonly ExplainRow[], names: Readonly<Record<string, string>>, limit = 5,
): string[] {
  if (rows.length === 0) return ['No direct or relay option exists for this delivery request'];
  const name = (id: string) => names[id] ?? id;
  const describe = (row: ExplainRow) => {
    const label = row.kind === 'relay' ? `relay via ${name(row.relayBusinessId!)}`
      : row.kind === 'evening_direct' ? 'evening direct' : 'morning direct';
    const parts = row.carriers.map(c => `${row.kind === 'relay' ? `${c.direction} carrier` : 'carrier'} ${name(c.employeeId)}`
      + (c.extraMin === null ? '' : ` ${signed(c.extraMin)} min, limit ${c.maxExtraMin}`)
      + (c.waitMin ? ` (waits ${c.waitMin} min)` : ''));
    if (row.pickupMin !== null && row.deliveryMin !== null) {
      parts.push(`pickup ${clock(row.pickupMin)}, delivered ${clock(row.deliveryMin)}`
        + (row.lateMin ? ` (${row.lateMin} min after the deadline)` : ''));
    }
    return parts.length ? `${label}: ${parts.join('; ')}` : label;
  };
  const feasible = rows.filter(row => row.feasible);
  const misses = rows.filter(row => !row.feasible).map((row, index) => ({ row, index }))
    .sort((a, b) => (a.row.missMin ?? Infinity) - (b.row.missMin ?? Infinity) || a.index - b.index)
    .map(({ row }) => row);
  const more = (count: number, what: string) => count > limit ? [`… ${count - limit} more ${what}`] : [];
  return [
    ...(feasible.length ? [] : ['no feasible option']),
    ...feasible.slice(0, limit).map(row => `feasible: ${describe(row)}`),
    ...more(feasible.length, 'feasible'),
    ...misses.slice(0, limit).map(row => `ruled out: ${describe(row)}`
      + (row.feasible ? '' : ` — ${row.reason}`)),
    ...more(misses.length, 'ruled out'),
  ];
}
