import { describe, expect, it } from 'vitest';
import { keyToControl } from '../../client/src/components/sim/playbackModel';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';

const base = createInitialRun(loadDefaultScenario());
const { scenario } = base;

describe('keyToControl and list keys', () => {
  it('does not clash with playback shortcuts', () => {
    const state = { clock: base.clock, nextEventMin: 1000, settings: scenario.settings, busy: false };
    for (const key of ['ArrowUp', 'ArrowDown', 'Home', 'End']) expect(keyToControl({ key }, state)).toBeNull();
  });
});
