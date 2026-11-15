// @vitest-environment jsdom
// #842, two faults PR #830 (#816) saw in headless Chrome and left alone:
// 1. When a journey ends (every step done, "Journey complete: …" in the Play bar) there is no current step,
//    so the #718 scroll did nothing and the Delivered step's meta line sat about 45 px below the
//    Inspector's fold at 1440 x 900. The last step now scrolls into view ('nearest') once, when the journey
//    becomes complete, and not while keyboard focus is on another step (#725).
// 2. In the narrowest map (220 px: a 900 px window with both panels open) the floating Play bar's step line
//    took three or four lines, so the bar grew upward and Play/Pause moved at each step. The shown line is
//    now cut at two lines with an ellipsis; the full text is its title and the visually hidden live region.
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlaybackControls } from '../../client/src/components/sim/v2/controls/PlaybackControls';
import { JourneyTimeline } from '../../client/src/components/sim/v2/journey/JourneyTimeline';
import { buildJourney, type Journey } from '../../client/src/components/sim/v2/journey/journeyModel';
import { mount } from './kitDom';
import { T, map, simAt } from './sim-v2-journey-sample';
import { parseCss, read, type Rule } from './sim-v2-qa-css-rules';

const journeyAt = (timeMin: number, status: string) =>
  buildJourney({ shipmentId: 'shp-2', sim: simAt(timeMin, { 'shp-2': status } as never), map }) as Journey;

let scrolled: Array<{ el: Element; opts: unknown }> = [];
const original = Element.prototype.scrollIntoView;
beforeEach(() => {
  scrolled = [];
  // jsdom has no layout and no scrollIntoView: record which element asked to be shown.
  Element.prototype.scrollIntoView = function (this: Element, opts?: unknown) {
    scrolled.push({ el: this, opts });
  } as Element['scrollIntoView'];
});
afterEach(() => {
  Element.prototype.scrollIntoView = original;
});

const steps = (c: ParentNode) => [...c.querySelectorAll<HTMLLIElement>('.jt__steps > .jt-step')];

describe('the Delivered step scrolls into view when the journey ends (#842)', () => {
  // The relay sample shp-2: on the second leg the last step (Delivered) is the current one.
  const lastCurrent = journeyAt(T.onLeg2, 'picked_up');
  const delivered = journeyAt(T.afterDelivery, 'delivered');

  it('the sample goes from one step current to every step done', () => {
    expect(lastCurrent.steps.filter((s) => s.state === 'current')).toHaveLength(1);
    expect(delivered.steps.every((s) => s.state === 'done')).toBe(true);
  });

  it('scrolls the last step (with its meta line) into view, nearest edge, once when every step is done', () => {
    const m = mount(<JourneyTimeline journey={lastCurrent} onSeek={() => {}} />);
    expect(scrolled).toHaveLength(1); // #718: the current step

    m.rerender(<JourneyTimeline journey={delivered} onSeek={() => {}} />);
    expect(scrolled).toHaveLength(2);
    const last = steps(m.container).at(-1)!;
    expect(scrolled[1].el).toBe(last);
    expect(scrolled[1].opts).toEqual({ block: 'nearest' });
    expect(last.textContent).toContain(`Step ${delivered.steps.length}:`);
    expect(last.querySelector('.jt-step__meta')).not.toBeNull(); // the meta line is inside what is shown

    // The next polls of the finished journey: no new scroll, so a reader who scrolled up is left alone.
    m.rerender(<JourneyTimeline journey={journeyAt(T.afterDelivery + 1, 'delivered')} onSeek={() => {}} />);
    m.rerender(<JourneyTimeline journey={journeyAt(T.afterDelivery + 2, 'delivered')} onSeek={() => {}} />);
    expect(scrolled).toHaveLength(2);
    m.unmount();
  });

  it('also when a seek jumps from an earlier step straight to the end', () => {
    const m = mount(<JourneyTimeline journey={journeyAt(T.onLeg1, 'picked_up')} onSeek={() => {}} />);
    expect(scrolled).toHaveLength(1);
    m.rerender(<JourneyTimeline journey={delivered} onSeek={() => {}} />);
    expect(scrolled).toHaveLength(2);
    expect(scrolled[1].el).toBe(steps(m.container).at(-1));
    m.unmount();
  });

  it('does not scroll while keyboard focus is on another step of the list', () => {
    const m = mount(<JourneyTimeline journey={lastCurrent} onSeek={() => {}} />);
    const first = steps(m.container)[0].querySelector('button')!;
    first.focus();
    expect(document.activeElement).toBe(first);
    m.rerender(<JourneyTimeline journey={delivered} onSeek={() => {}} />);
    expect(scrolled).toHaveLength(1); // only the #718 scroll on mount
    expect(document.activeElement).toBe(first);
    m.unmount();
  });

  it('does not scroll when a package that is already delivered is opened', () => {
    const m = mount(<JourneyTimeline journey={delivered} onSeek={() => {}} />);
    m.rerender(<JourneyTimeline journey={journeyAt(T.afterDelivery + 1, 'delivered')} onSeek={() => {}} />);
    expect(scrolled).toHaveLength(0);
    m.unmount();
  });
});

describe('the Play bar step line is at most two lines (#842)', () => {
  const FILES = ['client/src/components/sim/v2/controls/controls.css', 'client/src/components/sim/v2/compose/compose.css'];
  const RULES: Rule[] = FILES.flatMap((f) => parseCss(read(f), f));
  const decls = (selector: string) =>
    new Map(RULES.filter((r) => !r.media && r.selectors.includes(selector)).flatMap((r) => r.decls));
  const em = (v: string | undefined) => (v && /^\d+(\.\d+)?em$/.test(v) ? parseFloat(v) : NaN);

  it('the shown line is clamped to two lines with an ellipsis, and its two-line reserve (#816) stays', () => {
    const line = decls('.ctl-line');
    expect(line.get('display')).toBe('-webkit-box');
    expect(line.get('-webkit-box-orient')).toBe('vertical');
    expect(line.get('-webkit-line-clamp')).toBe('2');
    expect(line.get('line-clamp')).toBe('2');
    expect(line.get('overflow')).toBe('hidden');
    const lineHeight = Number(line.get('line-height'));
    expect(lineHeight).toBeGreaterThan(1);
    // Never taller than two lines, whatever the browser does with the clamp.
    expect(em(line.get('max-height'))).toBeLessThanOrEqual(2 * lineHeight + 0.001);
    // In a journey it is always exactly two lines high, so Play/Pause does not move at a step.
    const reserve = em(decls('.ctl-playback[data-play-action$="_journey"] .ctl-line').get('min-height'));
    expect(reserve).toBeGreaterThanOrEqual(2 * lineHeight - 0.001);
    expect(reserve).toBe(em(line.get('max-height')));
    // No @media rule lets it grow at some width.
    expect(RULES.filter((r) => r.media && r.selectors.some((s) => s.includes('ctl-line')))).toEqual([]);
  });

  it('the live region with the full text is visually hidden, never display: none', () => {
    const status = decls('.ctl-status');
    expect(status.get('position')).toBe('absolute');
    expect([status.get('width'), status.get('height')]).toEqual(['1px', '1px']);
    expect(status.get('overflow')).toBe('hidden');
    expect(status.get('clip-path')).toBe('inset(50%)');
    expect(status.has('display')).toBe(false);
  });

  it('the full text stays available: the title of the shown copy and the live region for screen readers', () => {
    const text = 'Step 4 of 4 next: Delivered to recipient at Brooklyn Roasting Company.';
    const html = renderToStaticMarkup(
      <PlaybackControls button={{ label: 'Pause', action: 'pause_journey', note: null }} status={text} onToggle={() => {}} onReset={() => {}} />,
    );
    expect(html).toContain(`<p class="ctl-line" aria-hidden="true" title="${text}">${text}</p>`);
    expect(html).toContain(`<p class="ctl-status" role="status">${text}</p>`);
    // Idle: no shown line, the empty live region stays in the page.
    const idle = renderToStaticMarkup(
      <PlaybackControls button={{ label: 'Play', action: 'play_network', note: null }} onToggle={() => {}} onReset={() => {}} />,
    );
    expect(idle).not.toContain('ctl-line');
    expect(idle).toContain('<p class="ctl-status" role="status"></p>');
  });
});
