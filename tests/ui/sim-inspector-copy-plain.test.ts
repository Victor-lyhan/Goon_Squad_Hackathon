// #917: the simulator's Inspector, its network labels and the map's route tooltip in plain words.
// No "Leg"/"Legs", no "ID", no "Relay leg n of m", no "no street route cached" (and no hub or trip):
// the journey timeline's words instead (DECISIONS pass 67: "A · <name>" / "B · <name>").
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildLayerSpecs, type PathSpec } from '../../client/src/components/map/layers';
import type { MapRoute } from '../../client/src/components/map/types';
import { BusinessInspector } from '../../client/src/components/sim/v2/inspector/BusinessInspector';
import { EmployeeInspector } from '../../client/src/components/sim/v2/inspector/EmployeeInspector';
import {
  businessInspector, carrierRoleLabel, employeeInspector,
} from '../../client/src/components/sim/v2/inspector/inspectorModel';
import { carrierPart, deliveryLabel, journeyLegLabel } from '../../client/src/components/sim/v2/network/networkIndex';
import { buildNetworkView, hoverText } from '../../client/src/components/sim/v2/network/networkModel';
import { BIZ, EMP, makeMap, makeSim } from './sim-v2-inspector-fixture';
import * as net from './sim-v2-network-fixture';

/** The words this issue takes out of the simulator's text. */
const BANNED: ReadonlyArray<[string, RegExp]> = [
  ['leg', /\blegs?\b/i],
  ['ID', /\bids?\b/i],
  ['cached', /\bcached\b/i],
  ['hub', /\bhubs?\b/i],
  ['trip', /\btrips?\b/i],
];
const bannedIn = (texts: string[]) =>
  texts.flatMap((t) => BANNED.filter(([, re]) => re.test(t)).map(([w]) => `${w}: ${JSON.stringify(t)}`));

/** Keys that hold a code value (looked up, never shown). Everything else in a model is text. */
const CODE_KEYS = new Set(['id', 'shipmentId', 'jobId', 'key']);
function modelStrings(v: unknown, key = ''): string[] {
  if (typeof v === 'string') return CODE_KEYS.has(key) ? [] : [v];
  if (Array.isArray(v)) return v.flatMap((x) => modelStrings(x, key));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => modelStrings(x, k));
  return [];
}

/** What a person reads or hears in a static render: the text and every aria-label. */
function renderedStrings(html: string): string[] {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const labels = [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]);
  return [text, ...labels];
}

const sim = makeSim();
const map = makeMap();
const noop = () => {};
const handlers = { onSelectPackage: noop, onSelectEmployee: noop, onSelectBusiness: noop, onFocus: noop, onClear: noop };

describe('#917 Inspector copy', () => {
  // The sender sends one direct (Menu proofs) and one relay package (Author galleys); Maya carries two
  // jobs: the direct package and carrier B's part of the relay one.
  const business = businessInspector(BIZ.sender, sim, map)!;
  const relayHolder = businessInspector(BIZ.relay, sim, map)!;
  const maya = employeeInspector(EMP.maya, sim, map)!;
  const jordan = employeeInspector(EMP.jordan, sim, map)!;

  it('the fixture has what the issue asks for', () => {
    expect(business.sent.map((r) => r.planKind)).toEqual(['Direct', 'Relay']);
    expect(maya.legs).toHaveLength(2);
    expect(maya.legs.map((l) => l.packageLabel)).toEqual(['Menu proofs', 'Author galleys']);
  });

  it('no model string a person sees has leg, ID, cached, hub or trip', () => {
    for (const m of [business, relayHolder, maya, jordan]) expect(bannedIn(modelStrings(m))).toEqual([]);
  });

  it('no rendered text or aria-label has them either', () => {
    const htmls = [
      renderToStaticMarkup(createElement(BusinessInspector, { model: business, ...handlers })),
      renderToStaticMarkup(createElement(BusinessInspector, { model: relayHolder, ...handlers })),
      renderToStaticMarkup(createElement(EmployeeInspector, { model: maya, ...handlers })),
      renderToStaticMarkup(createElement(EmployeeInspector, { model: jordan, ...handlers })),
    ];
    for (const html of htmls) expect(bannedIn(renderedStrings(html))).toEqual([]);
  });

  it('a relay package names its carriers "A · <name>" and "B · <name>", a direct one "Carrier <name>"', () => {
    const html = renderToStaticMarkup(createElement(BusinessInspector, { model: business, ...handlers }));
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('A · Jordan Lee');
    expect(text).toContain('B · Maya Ortiz');
    expect(text).toContain('Carrier Maya Ortiz');
    expect([carrierRoleLabel(0, 1), carrierRoleLabel(0, 2), carrierRoleLabel(1, 2)]).toEqual(['Carrier', 'A ·', 'B ·']);
  });

  it('the employee lists packages by their label, with the journey\'s carrier letter for a relay', () => {
    expect(maya.legs.map((l) => `${l.packageLabel}: ${l.legLabel}`)).toEqual([
      'Menu proofs: Direct', 'Author galleys: Relay · carrier B',
    ]);
    expect(jordan.legs.map((l) => l.legLabel)).toEqual(['Relay · carrier A']);
    const html = renderToStaticMarkup(createElement(EmployeeInspector, { model: maya, ...handlers }));
    expect(html).toContain('Packages <span class="insp-count">2</span>');
    expect(html).not.toContain('EMP-1');
  });
});

describe('#917 network labels', () => {
  const nmap = net.makeMap();
  const nsim = net.makeSim();
  const view = buildNetworkView({ map: nmap, sim: nsim });

  it('route labels and hover texts use the carrier letters, never "leg n of m"', () => {
    const labels = view.routes.map((r) => r.label ?? '');
    expect(labels).toContain('Ceramic samples · A · Sam Rivera');
    expect(labels).toContain('Ceramic samples · B · Li Chen');
    expect(labels).toContain('Astoria product proofs · carried by Maya Ortiz');
    const texts = view.routes.map((r) => hoverText({ id: r.id, kind: r.kind, label: r.label ?? '', role: '' }, nmap, nsim));
    expect(texts).toContain('Ceramic samples · Delivery route · B · Li Chen');
    expect(bannedIn([...labels, ...texts])).toEqual([]);
  });

  it('the helpers without names: still a letter, never a number', () => {
    expect(carrierPart(undefined, 0, 2)).toBe('carrier A');
    expect(carrierPart('', 0, 1)).toBeNull();
    expect(journeyLegLabel(null, 0)).toBe('Carrier A');
    expect(bannedIn([deliveryLabel('Ceramic samples', null, 1, 2)!, journeyLegLabel('Li Chen', 1)])).toEqual([]);
  });
});

describe('#917 map tooltip of a straight line', () => {
  const route: MapRoute = {
    id: 'r1', kind: 'leg', carried: true, dashed: true, label: 'A · Cy Lam', ownerIds: [],
    path: [[-73.99, 40.70], [-73.99, 40.72]],
  };
  const specs = buildLayerSpecs({
    places: [], routes: [route], movers: [], selectedIds: [],
    visible: { routes: true, businesses: true, homes: true, packages: true },
  });
  const data = specs.filter((s): s is PathSpec => s.type === 'path').flatMap((s) => s.data);

  it('says "Straight line: street route not loaded", and is still drawn as dashes', () => {
    expect(data.length).toBeGreaterThan(1);
    for (const d of data) {
      expect(d.item.role).toBe('Delivery route · Straight line: street route not loaded');
      expect(d.path).toHaveLength(2);
    }
    expect(bannedIn(data.map((d) => `${d.item.label}\n${d.item.role}`))).toEqual([]);
  });
});
