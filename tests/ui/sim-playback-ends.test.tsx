import { describe, expect, it } from 'vitest';
import { toPlaybackModel } from '../../client/src/components/sim/playbackModel';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import type { Run } from '../../shared/types';

const base = createInitialRun(loadDefaultScenario());
const { settings } = base.scenario;
const at = (timeMin: number, over: Partial<Run['clock']> = {}): Run => ({ ...base, clock: { ...base.clock, timeMin, ...over } });

describe('toPlaybackModel with a real Demo-city clock', () => {
  it('time label is identical for identical minutes (no extra announcements)', () => {
    const c = at(1000).clock;
    expect(toPlaybackModel(c, 1010, settings).timeLabel).toBe(toPlaybackModel({ ...c }, 1020, settings).timeLabel);
  });
});
