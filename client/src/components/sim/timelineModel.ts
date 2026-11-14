import type { Employee, Hub, Shipment, SimEvent } from '../../../../shared/types';
import { formatMin } from './simFormat';

export type TimelineRow = {
  id: string;
  timeLabel: string;
  text: string;
  state: 'done' | 'next' | 'upcoming';
};

function eventText(
  e: SimEvent,
  shipments: Map<string, Shipment>,
  employees: Map<string, Employee>,
  hubs: Map<string, Hub>,
): string {
  const who = employees.get(e.employeeId)?.name ?? 'A courier';
  const label = shipments.get(e.shipmentId)?.label;
  const pkg = label ? `“${label}”` : 'a package';
  const hub = (e.hubId && hubs.get(e.hubId)?.name) || 'a hub';
  switch (e.kind) {
    case 'pickup': return `${who} picked up ${pkg}`;
    case 'hub_drop': return `${who} dropped ${label ? 'it' : pkg} at ${hub}`;
    case 'hub_pickup': return `${who} collected ${label ? 'it' : pkg} from ${hub}`;
    case 'delivered': return `${who} delivered ${label ? 'it' : pkg}`;
  }
}

export function toTimelineRows(
  events: SimEvent[],
  timeMin: number,
  shipments: Shipment[],
  employees: Employee[],
  hubs: Hub[],
): TimelineRow[] {
  const s = new Map(shipments.map((x) => [x.id, x]));
  const em = new Map(employees.map((x) => [x.id, x]));
  const h = new Map(hubs.map((x) => [x.id, x]));
  let nextMin: number | undefined;
  for (const e of events) {
    if (e.timeMin > timeMin && (nextMin === undefined || e.timeMin < nextMin)) nextMin = e.timeMin;
  }
  return events.map((e) => ({
    id: e.id,
    timeLabel: formatMin(e.timeMin),
    text: eventText(e, s, em, h),
    state: e.timeMin <= timeMin ? 'done' : e.timeMin === nextMin ? 'next' : 'upcoming',
  }));
}
