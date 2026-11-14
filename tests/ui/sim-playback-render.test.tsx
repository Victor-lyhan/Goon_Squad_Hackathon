import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlaybackBar } from '../../client/src/components/sim/PlaybackBar';

const clock = { phase: 'locked', playing: false, timeMin: 1000, speed: 120 } as const;
const settings = { simStartMin: 930, simEndMin: 2160 };
const html = (busy: boolean) =>
  renderToStaticMarkup(<PlaybackBar clock={clock} nextEventMin={null} settings={settings} busy={busy} onControl={() => {}} />);

describe('PlaybackBar scrubber', () => {
  it('renders a labeled range over the sim window at the clock time', () => {
    const h = html(false);
    expect(h).toContain('aria-label="Simulation time"');
    expect(h).toContain('type="range"');
    expect(h).toContain('min="930"');
    expect(h).toContain('max="2160"');
    expect(h).toContain('value="1000"');
    expect(h).toContain('Day 1, 4:40 PM');
  });
  it('is disabled while busy', () => {
    const tag = html(true).match(/<input[^>]*>/)![0];
    expect(tag).toContain('disabled');
    expect(html(false).match(/<input[^>]*>/)![0]).not.toContain('disabled');
  });
});
