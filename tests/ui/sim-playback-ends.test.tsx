import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlaybackBar } from '../../client/src/components/sim/PlaybackBar';
import { toPlaybackModel } from '../../client/src/components/sim/playbackModel';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { buildSimulatorResponse } from '../../server/api/simulator';
import { applyControl } from '../../server/clock';
import type { Run } from '../../shared/types';

const base = createInitialRun(loadDefaultScenario());
const { settings } = base.scenario;
const lastDay1 = Math.max(...base.events.filter((e) => e.timeMin < 1440).map((e) => e.timeMin));
const firstDay2 = Math.min(...base.events.filter((e) => e.timeMin >= 1440).map((e) => e.timeMin));
const morning = firstDay2 - 5;
const at = (timeMin: number, over: Partial<Run['clock']> = {}): Run => ({ ...base, clock: { ...base.clock, timeMin, ...over } });

function render(run: Run) {
  const sim = buildSimulatorResponse(run);
  const html = renderToStaticMarkup(
    <PlaybackBar clock={sim.clock} nextEventMin={sim.nextEventMin} settings={settings}
      morningTargetMin={morning} onControl={() => {}} />,
  );
  const enabled = (label: string) => {
    const m = new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`).exec(html);
    expect(m, label).not.toBeNull();
    return !/disabled=""/.test(m![0]);
  };
  return { sim, html, enabled };
}

const afterMorning = applyControl(at(lastDay1).clock, { action: 'jump_to_morning' }, base.events, settings);
const finished = applyControl(base.clock, { action: 'finish' }, base.events, settings);

describe('PlaybackBar states with real Demo-city snapshots', () => {
  it('jump_to_morning target matches the test assumption', () => {
    expect(afterMorning.timeMin).toBe(morning);
  });

  it('at simStartMin: play, next, morning, finish, reset enabled', () => {
    const { enabled, sim } = render(at(settings.simStartMin));
    expect(sim.nextEventMin).not.toBeNull();
    for (const l of ['Play simulation', 'Jump to next event', 'Jump to morning', 'Finish simulation', 'Reset playback']) expect(enabled(l), l).toBe(true);
  });

  it('at the last Day 1 event: next event still enabled (Day 2 events exist), morning enabled', () => {
    const { enabled } = render(at(lastDay1));
    expect(enabled('Jump to next event')).toBe(true);
    expect(enabled('Jump to morning')).toBe(true);
  });

  it('after jump_to_morning: morning disabled, next event and play enabled', () => {
    const { enabled } = render({ ...base, clock: afterMorning });
    expect(enabled('Jump to morning')).toBe(false);
    expect(enabled('Jump to next event')).toBe(true);
    expect(enabled('Play simulation')).toBe(true);
  });

  it('at simEndMin: play, next, morning and finish disabled; says finished and points to Reset', () => {
    const { enabled, html } = render({ ...base, clock: finished });
    for (const l of ['Play simulation', 'Jump to next event', 'Jump to morning', 'Finish simulation']) expect(enabled(l), l).toBe(false);
    expect(enabled('Reset playback')).toBe(true);
    expect(html).toContain('Run finished');
    expect(html).toContain('Reset playback');
  });

  it('speed buttons use aria-pressed for the current speed only', () => {
    const { html } = render(at(settings.simStartMin, { speed: 120 }));
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(/aria-label="Speed 120 times"[^>]*aria-pressed="true"/.test(html)).toBe(true);
  });

  it('play/pause name matches state; live region is polite', () => {
    expect(render(at(1000, { playing: true })).html).toContain('aria-label="Pause simulation"');
    const { html } = render(at(1000, { playing: false }));
    expect(html).toContain('aria-label="Play simulation"');
    expect(html).toMatch(/role="status" aria-live="polite"[^>]*>Day 1, /);
  });

  it('time label is identical for identical minutes (no extra announcements)', () => {
    const c = at(1000).clock;
    expect(toPlaybackModel(c, 1010, settings).timeLabel).toBe(toPlaybackModel({ ...c }, 1020, settings).timeLabel);
  });
});
