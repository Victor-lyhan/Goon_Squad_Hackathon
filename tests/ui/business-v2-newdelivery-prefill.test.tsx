// @vitest-environment jsdom
// MVP IV F1 groundwork (#771, docs/mvp4.md): the New delivery form opens prefilled from a parsed request and
// marks the fields the sentence did not fill. The first half is the pure model (draftFromParsed); the second
// is the form in a real DOM, where focus, editing and Send actually run. No text box and no parse call here.
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShipmentResponse } from '../../shared/v2/api';
import { CreateShipmentRequest } from '../../shared/v2/schemas';
import type { NetworkBusiness } from '../../shared/v2/types';
import { createShipment } from '../../client/src/api/v2';
import { NewDeliveryForm, NewDeliveryFormView } from '../../client/src/components/business/v2/NewDeliveryForm';
import {
  DRAFT_FIELDS, NEEDS_INPUT_HINT, draftFromParsed, emptyDraft, firstNeedsInput, toRequest, validate,
  type DraftField, type NewDeliveryDraft, type ParsedFields,
} from '../../client/src/components/business/v2/newDeliveryModel';
import { ACME, ATLAS, BAKERY, BUSINESSES, directPlan, view } from './business-v2-details-sample';
import { button, byLabel, click, flush, mount, select, textOf, typeInto } from './kitDom';

const T = 10_000;
const CONTEXT = { originId: ACME.id, businesses: BUSINESSES };

const NOTHING: ParsedFields = {
  destinationBusinessId: null, label: null, category: null, description: null,
  weightKg: null, readyMin: null, deadlineMin: null,
};
/** "A small box of lab samples (two sealed vials, 1.2 kg) to Bakery Row, ready 4:30 PM, by 11 PM today." */
const EVERYTHING: ParsedFields = {
  destinationBusinessId: BAKERY.id, label: 'Lab samples', category: 'small_box', description: 'Two sealed vials',
  weightKg: 1.2, readyMin: 990, deadlineMin: 1380,
};
/** Every field a sentence can fill, in screen order. The two instruction fields are never among them. */
const PARSEABLE: DraftField[] = [
  'recipientId', 'label', 'category', 'weightKg', 'description', 'readyTime', 'deadlineDay', 'deadlineTime',
];

describe('draftFromParsed (pure model)', () => {
  it('all null: the empty draft, with every parseable field listed in screen order', () => {
    const { draft, needsInput } = draftFromParsed(NOTHING, CONTEXT);
    expect(draft).toEqual(emptyDraft());
    expect(needsInput).toEqual(PARSEABLE);
    expect(needsInput).not.toContain('pickupInstructions');
    expect(needsInput).not.toContain('dropoffInstructions');
  });

  it('all filled: every value lands in its form field and nothing is listed', () => {
    const { draft, needsInput } = draftFromParsed(EVERYTHING, CONTEXT);
    expect(draft).toEqual({
      recipientId: BAKERY.id, label: 'Lab samples', category: 'small_box', weightKg: '1.2',
      description: 'Two sealed vials', pickupInstructions: '', dropoffInstructions: '',
      readyTime: '16:30', deadlineDay: 1, deadlineTime: '23:00',
    });
    expect(needsInput).toEqual([]);
    // The draft is one the form accepts as it is, and it sends back exactly what was parsed.
    expect(validate(draft, ACME.id)).toEqual({});
    expect(toRequest(draft, ACME.id, 'req-1')).toMatchObject({ originBusinessId: ACME.id, ...EVERYTHING });
  });

  it('a Day 2 deadline: minute 1950 is Day 2, 08:30 (AGENTS.md)', () => {
    const { draft, needsInput } = draftFromParsed({ ...EVERYTHING, deadlineMin: 1950 }, CONTEXT);
    expect(draft.deadlineDay).toBe(2);
    expect(draft.deadlineTime).toBe('08:30');
    expect(needsInput).toEqual([]);
    expect(toRequest(draft, ACME.id, 'req-1').deadlineMin).toBe(1950);
  });

  it('the origin as recipient: left empty and listed (the sender is always the signed-in business)', () => {
    const { draft, needsInput } = draftFromParsed({ ...EVERYTHING, destinationBusinessId: ACME.id }, CONTEXT);
    expect(draft.recipientId).toBe('');
    expect(needsInput).toEqual(['recipientId']);
    expect(draft.label).toBe('Lab samples'); // the rest of the sentence is kept
  });

  it('an unknown recipient: left empty and listed', () => {
    const { draft, needsInput } = draftFromParsed({ ...EVERYTHING, destinationBusinessId: 'biz-nowhere' }, CONTEXT);
    expect(draft.recipientId).toBe('');
    expect(needsInput).toEqual(['recipientId']);
  });

  it('a Day 2 ready time: the default stays and readyTime is listed (the form has Day 1 only)', () => {
    const { draft, needsInput } = draftFromParsed({ ...EVERYTHING, readyMin: 1500, deadlineMin: 1950 }, CONTEXT);
    expect(draft.readyTime).toBe(emptyDraft().readyTime);
    expect(needsInput).toEqual(['readyTime']);
    expect(draft.deadlineDay).toBe(2); // the deadline is not touched by it
  });

  it('the edges of Day 1 and Day 2', () => {
    const at = (readyMin: number | null, deadlineMin: number | null) =>
      draftFromParsed({ ...EVERYTHING, readyMin, deadlineMin }, CONTEXT);
    expect(at(0, 1439).draft).toMatchObject({ readyTime: '00:00', deadlineDay: 1, deadlineTime: '23:59' });
    expect(at(1439, 1440).draft).toMatchObject({ readyTime: '23:59', deadlineDay: 2, deadlineTime: '00:00' });
    expect(at(1440, 2879).draft).toMatchObject({ readyTime: '16:00', deadlineDay: 2, deadlineTime: '23:59' });
    expect(at(1440, 2879).needsInput).toEqual(['readyTime']);
    expect(at(-1, 990).needsInput).toEqual(['readyTime']);
  });

  it('a deadline the form cannot hold (Day 3, negative, not a whole minute): default kept, day and time listed', () => {
    for (const deadlineMin of [2880, 4000, -5, 1950.5, Number.NaN]) {
      const { draft, needsInput } = draftFromParsed({ ...EVERYTHING, deadlineMin }, CONTEXT);
      expect(draft.deadlineDay).toBe(emptyDraft().deadlineDay);
      expect(draft.deadlineTime).toBe(emptyDraft().deadlineTime);
      expect(needsInput).toEqual(['deadlineDay', 'deadlineTime']);
    }
  });

  it('blank text counts as not given; text is trimmed', () => {
    const { draft, needsInput } = draftFromParsed({ ...EVERYTHING, label: '   ', description: '  Paper  ' }, CONTEXT);
    expect(draft.label).toBe('');
    expect(draft.description).toBe('Paper');
    expect(needsInput).toEqual(['label']);
  });

  it('a weight or category that is no value at all is listed; a weight over the limit is shown for Send to refuse', () => {
    const odd = draftFromParsed(
      { ...EVERYTHING, weightKg: Number.NaN, category: 'pallet' as unknown as ParsedFields['category'] }, CONTEXT,
    );
    expect(odd.draft).toMatchObject({ weightKg: emptyDraft().weightKg, category: emptyDraft().category });
    expect(odd.needsInput).toEqual(['category', 'weightKg']);

    const heavy = draftFromParsed({ ...EVERYTHING, weightKg: 3 }, CONTEXT);
    expect(heavy.draft.weightKg).toBe('3');
    expect(heavy.needsInput).toEqual([]);
    expect(validate(heavy.draft, ACME.id).weightKg).toBe('Max 2 kg');
  });

  it('does not change its input and returns a new draft each time', () => {
    const parsed = { ...EVERYTHING };
    const a = draftFromParsed(parsed, CONTEXT);
    const b = draftFromParsed(parsed, CONTEXT);
    expect(parsed).toEqual(EVERYTHING);
    expect(a.draft).not.toBe(b.draft);
    expect(a).toEqual(b);
  });

  it('firstNeedsInput is the first listed field on screen, whatever order the list is in', () => {
    expect(firstNeedsInput([])).toBeNull();
    expect(firstNeedsInput(['deadlineTime', 'weightKg', 'label'])).toBe('label');
    expect(firstNeedsInput(DRAFT_FIELDS)).toBe('recipientId');
  });
});

// ---------- The form ----------

const matchedAnswer = (id = 'shp-41'): ShipmentResponse => ({
  ...view({ ...directPlan, id: `plan-${id}`, shipmentId: id }, 'scheduled', {}, { id, label: 'Lab samples' }),
  matched: true,
});
const unmatchedAnswer = (id = 'shp-42'): ShipmentResponse => ({
  ...view(null, 'unmatched', { unmatchedReason: 'No commute passes Bakery Row.' }, { id, label: 'Lab samples' }),
  matched: false,
});

type Props = {
  origin?: NetworkBusiness;
  dashboardVersion?: number;
  initialDraft?: NewDeliveryDraft;
  needsInput?: readonly DraftField[];
  onSubmit?: (req: CreateShipmentRequest) => Promise<ShipmentResponse>;
};

function setup(p: Props = {}) {
  const onSubmit = vi.fn(p.onSubmit ?? (async () => matchedAnswer()));
  const el = (over: Props = {}) => (
    <NewDeliveryForm
      origin={over.origin ?? p.origin ?? ACME}
      businesses={BUSINESSES}
      phase="planning"
      dashboardVersion={over.dashboardVersion ?? p.dashboardVersion}
      initialDraft={'initialDraft' in over ? over.initialDraft : p.initialDraft}
      needsInput={'needsInput' in over ? over.needsInput : p.needsInput}
      onSubmit={onSubmit}
      onOpenDelivery={() => {}}
      onCancel={() => {}}
    />
  );
  const m = mount(el());
  const c = m.container;
  const field = (label: string) => byLabel(c, label) as HTMLInputElement | HTMLSelectElement;
  /** The texts the control is described by (aria-describedby), in order. */
  const describedBy = (label: string) => (field(label).getAttribute('aria-describedby') ?? '')
    .split(' ').filter(Boolean).map((id) => textOf(document.getElementById(id)!));
  return {
    ...m, onSubmit, field, describedBy,
    rerenderWith: (over: Props) => m.rerender(el(over)),
    hinted: (label: string) => describedBy(label).includes(NEEDS_INPUT_HINT),
    hintCount: () => [...c.querySelectorAll('.nd-check')].filter((n) => textOf(n) === NEEDS_INPUT_HINT).length,
    send: () => button(c, /^(Find a delivery match|Try matching again)$/),
  };
}

/** "Send an envelope to Bakery Row by 8:30 tomorrow": recipient, type and deadline; the rest is left out. */
const SENTENCE: ParsedFields = { ...NOTHING, destinationBusinessId: BAKERY.id, category: 'envelope', deadlineMin: 1950 };
const prefilled = (parsed: ParsedFields = SENTENCE) => {
  const { draft, needsInput } = draftFromParsed(parsed, CONTEXT);
  return { initialDraft: draft, needsInput };
};

const LABELS: Record<DraftField, string> = {
  recipientId: 'Recipient', label: 'Package name', category: 'Type', weightKg: 'Weight (kg)',
  description: 'Contents', pickupInstructions: 'Pickup instructions (optional)',
  dropoffInstructions: 'Drop-off instructions (optional)', readyTime: 'Ready for pickup (Day 1)',
  deadlineDay: 'Deliver by: day', deadlineTime: 'Deliver by: time',
};

describe('New delivery form, prefilled from a parsed request', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('without the props: the empty form, no hint anywhere and no focus taken', () => {
    const f = setup();
    expect(f.hintCount()).toBe(0);
    expect(f.container.textContent).not.toContain(NEEDS_INPUT_HINT);
    expect(f.container.querySelector('.nd-field--check')).toBeNull();
    expect(document.activeElement).toBe(document.body);
    expect(f.field('Package name').value).toBe('');
    expect((f.field('Recipient') as HTMLSelectElement).selectedOptions[0].text).toBe('Choose a business');
    // The one field hint of the plain form is still the only description.
    expect(f.describedBy('Recipient')).toEqual(['Any business in the network']);
    expect(f.field('Package name').hasAttribute('aria-describedby')).toBe(false);
  });

  it('opens with the parsed values in the fields', () => {
    const f = setup(prefilled(EVERYTHING));
    expect((f.field('Recipient') as HTMLSelectElement).selectedOptions[0].text).toBe('Bakery Row · Williamsburg');
    expect(f.field('Package name').value).toBe('Lab samples');
    expect(f.field('Type').value).toBe('small_box');
    expect(f.field('Weight (kg)').value).toBe('1.2');
    expect(f.field('Contents').value).toBe('Two sealed vials');
    expect(f.field('Ready for pickup (Day 1)').value).toBe('16:30');
    expect(f.field('Deliver by: day').value).toBe('1');
    expect(f.field('Deliver by: time').value).toBe('23:00');
    // Nothing was left out: no hint, and focus stays where it was.
    expect(f.hintCount()).toBe(0);
    expect(document.activeElement).toBe(document.body);
  });

  it('marks exactly the listed fields with the hint, tied to the control by aria-describedby', () => {
    const p = prefilled();
    expect(p.needsInput).toEqual(['label', 'weightKg', 'description', 'readyTime']);
    const f = setup(p);
    for (const field of DRAFT_FIELDS) expect(f.hinted(LABELS[field]), field).toBe(p.needsInput.includes(field));
    expect(f.hintCount()).toBe(4);
    expect(f.describedBy('Package name')).toEqual([NEEDS_INPUT_HINT]);
    // A field with a hint of its own keeps it, and is described by both.
    expect(f.describedBy('Weight (kg)')).toEqual(['Up to 2 kg', NEEDS_INPUT_HINT]);
    // The filled fields show what the sentence said.
    expect((f.field('Recipient') as HTMLSelectElement).selectedOptions[0].text).toBe('Bakery Row · Williamsburg');
    expect(f.field('Deliver by: day').value).toBe('2');
    expect(f.field('Deliver by: time').value).toBe('08:30');
  });

  it('focuses the first listed field on open, in screen order whatever the order of the list', () => {
    const f = setup(prefilled());
    expect(document.activeElement).toBe(f.field('Package name'));
    f.unmount();

    const g = setup({ initialDraft: emptyDraft(), needsInput: ['deadlineTime', 'recipientId', 'weightKg'] });
    expect(document.activeElement).toBe(g.field('Recipient'));
    expect(g.describedBy('Recipient')).toEqual(['Any business in the network', NEEDS_INPUT_HINT]);
  });

  it('editing a listed field clears its hint and no other', () => {
    const f = setup(prefilled());
    typeInto(f.field('Package name'), 'L');
    expect(f.hinted('Package name')).toBe(false);
    expect(f.field('Package name').hasAttribute('aria-describedby')).toBe(false);
    expect(f.hintCount()).toBe(3);
    expect(f.hinted('Weight (kg)')).toBe(true);

    // Editing a field that was not listed changes no hint.
    select(f.field('Recipient'), 'Atlas Books · Long Island City');
    expect(f.hintCount()).toBe(3);

    typeInto(f.field('Weight (kg)'), '1.2');
    expect(f.describedBy('Weight (kg)')).toEqual(['Up to 2 kg']);
    typeInto(f.field('Contents'), 'Two sealed vials');
    typeInto(f.field('Ready for pickup (Day 1)'), '16:30');
    expect(f.hintCount()).toBe(0);
    expect(f.container.querySelector('.nd-field--check')).toBeNull();

    // Emptying the field again does not bring the hint back: it is the user's field now.
    typeInto(f.field('Package name'), '');
    expect(f.hinted('Package name')).toBe(false);
  });

  it('a poll (new props, same form) keeps the draft, the cleared hints and the focus', () => {
    const p = prefilled();
    const f = setup({ ...p, dashboardVersion: 1 });
    typeInto(f.field('Package name'), 'Lab samples');
    f.field('Contents').focus();
    // The parent re-renders with the props it opened the form with, and with a newer dashboard.
    f.rerenderWith({ ...prefilled(), dashboardVersion: 2 });
    expect(f.field('Package name').value).toBe('Lab samples');
    expect(f.hinted('Package name')).toBe(false);
    expect(f.hinted('Contents')).toBe(true);
    expect(document.activeElement).toBe(f.field('Contents'));
  });

  it('Send posts the edited draft as the expected CreateShipmentRequest, once', async () => {
    const f = setup(prefilled());
    typeInto(f.field('Package name'), 'Lab samples');
    typeInto(f.field('Contents'), 'Two sealed vials');
    typeInto(f.field('Weight (kg)'), '1.2');
    select(f.field('Recipient'), 'Atlas Books · Long Island City'); // the user corrects a parsed field too
    click(f.send());
    await flush();

    expect(f.onSubmit).toHaveBeenCalledTimes(1);
    const req = f.onSubmit.mock.calls[0][0];
    expect(req).toEqual({
      clientRequestId: req.clientRequestId,
      originBusinessId: ACME.id,
      destinationBusinessId: ATLAS.id,
      label: 'Lab samples',
      category: 'envelope',
      description: 'Two sealed vials',
      weightKg: 1.2,
      readyMin: 960, // the form's default, Day 1 16:00: the sentence gave none and the user kept it
      deadlineMin: 1950,
      pickupInstructions: '',
      dropoffInstructions: '',
    });
    expect(req.clientRequestId).toMatch(/^req-biz-acme-/);
    // The same path as a typed form: toRequest of the draft, and a request the contract accepts.
    const sent: NewDeliveryDraft = {
      ...prefilled().initialDraft, recipientId: ATLAS.id, label: 'Lab samples', description: 'Two sealed vials', weightKg: '1.2',
    };
    expect(req).toEqual(toRequest(sent, ACME.id, req.clientRequestId));
    expect(CreateShipmentRequest.safeParse(req).success).toBe(true);
  }, T);

  it('a fully parsed request sends unedited through the shipment API: one POST /api/v2/shipments', async () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url: String(input), body: JSON.parse(String(init?.body ?? 'null')) });
      return new Response(JSON.stringify(matchedAnswer('shp-77')), { status: 201, headers: { 'Content-Type': 'application/json' } });
    });
    const f = setup({ ...prefilled(EVERYTHING), onSubmit: (req) => createShipment(req) });
    click(f.send());
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('/api/v2/shipments');
    expect(calls[0].body).toMatchObject({
      originBusinessId: ACME.id, ...EVERYTHING, pickupInstructions: '', dropoffInstructions: '',
    });
    expect(textOf(f.container.querySelector('[role="status"]')!)).toContain('Delivery arranged.');
    expect(textOf(f.container.querySelector('[role="status"]')!)).toContain('shp-77');
  }, T);

  it('Send with a listed required field still empty: the usual error, next to the hint, and nothing is sent', async () => {
    const f = setup(prefilled());
    click(f.send());
    await flush();
    expect(f.onSubmit).not.toHaveBeenCalled();
    expect(f.field('Package name').getAttribute('aria-invalid')).toBe('true');
    expect(f.describedBy('Package name')).toHaveLength(2);
    expect(f.describedBy('Package name')[0]).toBe(NEEDS_INPUT_HINT);
    expect(document.activeElement).toBe(f.field('Package name'));
    // A listed field whose default is valid (the weight) keeps only its hint.
    expect(f.describedBy('Weight (kg)')).toEqual(['Up to 2 kg', NEEDS_INPUT_HINT]);
  }, T);

  it('after a matched Send the form starts a fresh package with no hints left', async () => {
    const f = setup(prefilled());
    typeInto(f.field('Package name'), 'Lab samples');
    typeInto(f.field('Contents'), 'Two sealed vials');
    expect(f.hintCount()).toBe(2); // weight and ready time: defaults the user accepted without editing
    click(f.send());
    await flush();
    expect(f.onSubmit).toHaveBeenCalledTimes(1);
    expect(f.field('Package name').value).toBe('');
    expect(f.hintCount()).toBe(0);
  }, T);

  it('after a no-match Send the draft and its remaining hints stay', async () => {
    const f = setup({ ...prefilled(), onSubmit: async () => unmatchedAnswer() });
    typeInto(f.field('Package name'), 'Lab samples');
    typeInto(f.field('Contents'), 'Two sealed vials');
    click(f.send());
    await flush();
    expect(f.field('Package name').value).toBe('Lab samples');
    expect(f.hinted('Weight (kg)')).toBe(true);
    expect(textOf(f.send())).toBe('Try matching again');
  }, T);

  it('another sending business: the prefill and its hints are dropped with the old draft', () => {
    const f = setup(prefilled());
    f.rerenderWith({ origin: ATLAS });
    expect(f.field('Package name').value).toBe('');
    expect((f.field('Recipient') as HTMLSelectElement).selectedOptions[0].text).toBe('Choose a business');
    expect(f.hintCount()).toBe(0);
  });

  it('the stateless view draws the hint for its needsInput (static render)', () => {
    const html = renderToStaticMarkup(
      <NewDeliveryFormView origin={ACME} businesses={BUSINESSES} phase="planning" draft={emptyDraft()}
        needsInput={['label']} errors={{}} status={{ kind: 'idle' }}
        onChange={() => {}} onSubmit={() => {}} onOpenDelivery={() => {}} onCancel={() => {}} />,
    );
    expect(html.split(NEEDS_INPUT_HINT)).toHaveLength(2);
    const id = /<p class="nd-check" id="([^"]+)">/.exec(html)![1];
    expect(html).toContain(`aria-describedby="${id}"`);
    expect(html).toContain('nd-field nd-field--check');
  });
});
