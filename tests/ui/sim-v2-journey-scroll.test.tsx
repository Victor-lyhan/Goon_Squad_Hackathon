// @vitest-environment jsdom
// #718 (headless Chrome QA at 1440 x 900): the journey legend and the timeline header fill the top of the
// Inspector, so the last steps of a relay journey ("Handed to …", "Delivered …") sat below its fold while
// the package moved there. The step the package is heading for now scrolls into view ('nearest') when it
// becomes the current one, and only then.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JourneyTimeline } from '../../client/src/components/sim/v2/journey/JourneyTimeline';
import { buildJourney, type Journey } from '../../client/src/components/sim/v2/journey/journeyModel';
import { mount } from './kitDom';
import { T, map, simAt } from './sim-v2-journey-sample';

const journeyAt = (timeMin: number, status: string) =>
  buildJourney({ shipmentId: 'shp-2', sim: simAt(timeMin, { 'shp-2': status } as never), map }) as Journey;

let scrolled: Array<{ text: string; opts: unknown }> = [];
const original = Element.prototype.scrollIntoView;
beforeEach(() => {
  scrolled = [];
  // jsdom has no layout and no scrollIntoView: record which element asked to be shown.
  Element.prototype.scrollIntoView = function (this: Element, opts?: unknown) {
    scrolled.push({ text: this.textContent ?? '', opts });
  } as Element['scrollIntoView'];
});
afterEach(() => {
  Element.prototype.scrollIntoView = original;
});

describe('JourneyTimeline keeps the current step in view', () => {
  it('scrolls the current step into view, nearest edge only, each time the current step changes', () => {
    const onLeg1 = journeyAt(T.onLeg1, 'picked_up');
    const current1 = onLeg1.steps.find((s) => s.state === 'current')!;
    const m = mount(<JourneyTimeline journey={onLeg1} onSeek={() => {}} />);
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0].text).toContain(`Step ${current1.n}:`);
    expect(scrolled[0].opts).toEqual({ block: 'nearest' });

    // Same current step on the next poll: no new scroll (a reader who scrolled up is left alone).
    m.rerender(<JourneyTimeline journey={journeyAt(T.onLeg1 + 1, 'picked_up')} onSeek={() => {}} />);
    expect(scrolled).toHaveLength(1);

    const overnight = journeyAt(T.overnight, 'at_hub');
    const current2 = overnight.steps.find((s) => s.state === 'current')!;
    expect(current2.n).toBeGreaterThan(current1.n);
    m.rerender(<JourneyTimeline journey={overnight} onSeek={() => {}} />);
    expect(scrolled).toHaveLength(2);
    expect(scrolled[1].text).toContain(`Step ${current2.n}:`);
    m.unmount();
  });

  it('does not scroll once the package is delivered (no current step)', () => {
    const done = journeyAt(T.afterDelivery, 'delivered');
    expect(done.steps.some((s) => s.state === 'current')).toBe(false);
    const m = mount(<JourneyTimeline journey={done} onSeek={() => {}} />);
    expect(scrolled).toHaveLength(0);
    m.unmount();
  });

  it('works where the browser has no scrollIntoView', () => {
    // @ts-expect-error: removed on purpose
    Element.prototype.scrollIntoView = undefined;
    const m = mount(<JourneyTimeline journey={journeyAt(T.onLeg1, 'picked_up')} onSeek={() => {}} />);
    expect(m.container.querySelector('[aria-current="step"]')).not.toBeNull();
    m.unmount();
  });
});
