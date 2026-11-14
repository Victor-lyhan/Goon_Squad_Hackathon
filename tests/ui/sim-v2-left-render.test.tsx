import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PlanningControls } from '../../client/src/components/sim/v2/controls/PlanningControls';
import { PlaybackControls } from '../../client/src/components/sim/v2/controls/PlaybackControls';
import { ScenarioControls } from '../../client/src/components/sim/v2/controls/ScenarioControls';
import { FINISHED_REASON, LOCKED_RECOMPUTE_REASON, PLANNING_NOTE } from '../../client/src/components/sim/v2/controls/controlsModel';
import { GenerateScenarioRequest } from '../../shared/v2/schemas';
import type { Clock } from '../../shared/v2/types';

const tags = (h: string, t: string) => h.match(new RegExp(`<${t}\\b[^>]*>`, 'g')) ?? [];
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const buttons = (h: string) => [...h.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ attrs: m[1], text: m[2] }));
const button = (h: string, text: string) => buttons(h).find((b) => b.text === text)!;
const isDisabled = (b: { attrs: string }) => /\sdisabled=""/.test(b.attrs);
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

const W = { simStartMin: 930, simEndMin: 2160 };
const clock = (over: Partial<Clock> = {}): Clock => ({ phase: 'planning', playing: false, timeMin: 930, speed: 120, ...over });

function playback(c: Clock, nextEventMin: number | null = 1000, busy = false) {
  const onControl = vi.fn();
  const html = renderToStaticMarkup(<PlaybackControls clock={c} {...W} nextEventMin={nextEventMin} busy={busy} onControl={onControl} />);
  expect(onControl).not.toHaveBeenCalled();
  return html;
}

/** Every input/select has a <label for> or an aria-label; every described-by target exists. */
function expectAccessible(html: string) {
  for (const t of [...tags(html, 'input'), ...tags(html, 'select')]) {
    const id = attr(t, 'id');
    const labelled = (id && html.includes(`for="${id}"`)) || attr(t, 'aria-label');
    expect(labelled, t).toBeTruthy();
  }
  for (const t of [...tags(html, 'input'), ...tags(html, 'button')]) {
    const ref = attr(t, 'aria-describedby');
    if (ref) for (const r of ref.split(' ')) expect(html, r).toContain(`id="${r}"`);
  }
  expect(html).not.toMatch(/NaN|undefined|>null</);
}

/** Disabled buttons have a title and point (aria-describedby) at visible reason text. */
function expectReasons(html: string) {
  for (const b of buttons(html).filter(isDisabled)) {
    expect(attr(`<x${b.attrs}>`, 'title'), b.text).toBeTruthy();
    const ref = attr(`<x${b.attrs}>`, 'aria-describedby');
    expect(ref, b.text).toBeTruthy();
    const target = html.match(new RegExp(`id="${ref}"[^>]*>([\\s\\S]*?)</(p|ul)>`))?.[1] ?? '';
    expect(unescape(target.replace(/<[^>]+>/g, ' ')).trim(), b.text).toMatch(/[A-Za-z]{3,}.*\./);
  }
}

describe('PlaybackControls static renders', () => {
  it('planning: Play, pressed 4x speed, scrubber at start with mono time, Next event enabled', () => {
    const html = playback(clock());
    expect(button(html, 'Play')).toBeTruthy();
    expect(isDisabled(button(html, 'Play'))).toBe(false);
    expect(attr(`<x${button(html, 'Play').attrs}>`, 'title')).toMatch(/locks the run/);
    const speeds = buttons(html).filter((b) => /^(1|4|20)x$/.test(b.text));
    expect(speeds.map((b) => [b.text, attr(`<x${b.attrs}>`, 'aria-pressed')])).toEqual([['1x', 'false'], ['4x', 'true'], ['20x', 'false']]);
    expect(speeds.map((b) => attr(`<x${b.attrs}>`, 'title'))).toEqual([
      '30 simulated minutes per second', '120 simulated minutes per second', '600 simulated minutes per second',
    ]);
    const range = tags(html, 'input').find((t) => attr(t, 'type') === 'range')!;
    expect([attr(range, 'min'), attr(range, 'max'), attr(range, 'step'), attr(range, 'value')]).toEqual(['930', '2160', '1', '930']);
    expect(html).toContain('>Simulation time</label>');
    expect(html).toMatch(/<output class="ctl-mono"[^>]*>Day 1, 3:30 PM<\/output>/);
    for (const t of ['Next event', 'Jump to morning', 'Finish', 'Reset playback']) expect(isDisabled(button(html, t))).toBe(false);
    expectAccessible(html);
    expectReasons(html);
  });

  it('locked + playing: Pause, 20x pressed, Next event disabled with a reason when there is none', () => {
    const html = playback(clock({ phase: 'locked', playing: true, timeMin: 1950, speed: 600 }), null);
    expect(isDisabled(button(html, 'Pause'))).toBe(false);
    expect(attr(`<x${button(html, '20x').attrs}>`, 'aria-pressed')).toBe('true');
    expect(isDisabled(button(html, 'Next event'))).toBe(true);
    expect(isDisabled(button(html, 'Jump to morning'))).toBe(true);
    expect(html).toContain('No more events in this run.');
    expect(html).toContain('Day 2, 8:30 AM');
    expectAccessible(html);
    expectReasons(html);
  });

  it('locked + paused: Play resumes (no lock warning), steps enabled', () => {
    const html = playback(clock({ phase: 'locked', playing: false, timeMin: 1200, speed: 30 }), 1300);
    expect(isDisabled(button(html, 'Play'))).toBe(false);
    expect(attr(`<x${button(html, 'Play').attrs}>`, 'title')).toBe('Resume the simulation');
    expect(attr(`<x${button(html, '1x').attrs}>`, 'aria-pressed')).toBe('true');
    expect(buttons(html).filter(isDisabled)).toEqual([]);
    expect(html).not.toContain('ctl-notes');
    expectAccessible(html);
  });

  it('finished: Play and Finish disabled with the finished reason, Reset playback enabled', () => {
    const html = playback(clock({ phase: 'locked', playing: false, timeMin: W.simEndMin }), null);
    for (const t of ['Play', 'Finish', 'Next event', 'Jump to morning']) expect(isDisabled(button(html, t)), t).toBe(true);
    expect(isDisabled(button(html, 'Reset playback'))).toBe(false);
    expect(html).toContain(FINISHED_REASON);
    expect(attr(tags(html, 'input')[0] ?? '', 'value')).toBe('2160');
    expect(html).toContain('Day 2, 12:00 PM');
    expectAccessible(html);
    expectReasons(html);
  });

  it('busy: every control disabled with one readable reason', () => {
    const html = playback(clock({ timeMin: 1000 }), 1100, true);
    expect(buttons(html).every(isDisabled)).toBe(true);
    expect(tags(html, 'input')[0]).toContain('disabled');
    expect(html).toContain('Waiting for the last control to finish.');
    expectReasons(html);
  });
});

describe('ScenarioControls static renders', () => {
  const value = GenerateScenarioRequest.parse({ preset: 'random', seed: 42 });

  for (const phase of ['planning', 'locked'] as const) {
    it(`${phase}: preset select and four labelled numeric fields, no hubs, Generate enabled`, () => {
      const onGenerate = vi.fn();
      const html = renderToStaticMarkup(<ScenarioControls value={value} phase={phase} onGenerate={onGenerate} />);
      const labels = [...html.matchAll(/<label for="[^"]+">([^<]+)<\/label>/g)].map((m) => m[1]);
      expect(labels).toEqual(['Preset', 'Seed', 'Employees', 'Packages', 'Detour limit (min)']);
      expect(html).not.toMatch(/hub/i);
      const inputs = tags(html, 'input');
      expect(inputs.map((t) => attr(t, 'value'))).toEqual(['42', '60', '24', '8']);
      expect(tags(html, 'option').find((t) => t.includes('selected'))).toContain('value="random"');
      expect(html).toContain('10 to 120');
      expect(html).toContain('5 to 60');
      expect(html).toContain('0 to 30');
      const gen = button(html, 'Generate');
      expect(isDisabled(gen)).toBe(false);
      expect(attr(`<x${gen.attrs}>`, 'type')).toBe('submit');
      expect(html).not.toContain('Generate new city'); // confirmation only appears after a click
      expectAccessible(html);
      expect(onGenerate).not.toHaveBeenCalled();
    });
  }

  it('demo preset explains that Packages applies to Random; busy disables with a reason', () => {
    const html = renderToStaticMarkup(<ScenarioControls value={{ ...value, preset: 'demo' }} phase="planning" busy onGenerate={vi.fn()} />);
    expect(tags(html, 'option').find((t) => t.includes('selected'))).toContain('value="demo"');
    expect(html).toContain('Packages count applies to Random');
    expect(isDisabled(button(html, 'Generate'))).toBe(true);
    expectAccessible(html);
    expectReasons(html);
  });
});

describe('PlanningControls static renders', () => {
  it('planning: both buttons enabled and the lock note is shown', () => {
    const html = renderToStaticMarkup(<PlanningControls phase="planning" onReset={vi.fn()} onRecompute={vi.fn()} />);
    expect(isDisabled(button(html, 'Start new planning cycle'))).toBe(false);
    expect(isDisabled(button(html, 'Recompute matches'))).toBe(false);
    expect(html).toContain(PLANNING_NOTE);
    expect(html).toContain('>Planning<');
  });

  it('locked: Recompute disabled with a visible reason, Start new planning cycle enabled even when busy', () => {
    const html = renderToStaticMarkup(<PlanningControls phase="locked" busy onReset={vi.fn()} onRecompute={vi.fn()} />);
    expect(isDisabled(button(html, 'Start new planning cycle'))).toBe(false);
    expect(isDisabled(button(html, 'Recompute matches'))).toBe(true);
    expect(html).toContain(LOCKED_RECOMPUTE_REASON);
    expect(html).toContain('>Locked<');
    expectReasons(html);
    expectAccessible(html);
  });
});

describe('controls.css', () => {
  const css = readFileSync('client/src/components/sim/v2/controls/controls.css', 'utf8');
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('no radius over 4px', () => {
    const radii = [...noComments.matchAll(/border-radius\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(radii.length).toBeGreaterThan(0);
    for (const r of radii) {
      for (const px of r.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px[1]), r).toBeLessThanOrEqual(4);
      expect(r).not.toMatch(/%|em\b|rem\b/);
    }
  });

  it('no box-shadow except a 1px focus ring, and no gradients', () => {
    expect(noComments).not.toMatch(/gradient/);
    const rules = [...noComments.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    for (const [, selector, body] of rules) {
      const shadow = body.match(/box-shadow\s*:\s*([^;]+)/)?.[1];
      if (!shadow) continue;
      expect(selector).toMatch(/:focus-visible/);
      expect(shadow.trim()).toMatch(/^0 0 0 1px\b/);
    }
  });

  it('no fixed width over 320px', () => {
    for (const m of noComments.matchAll(/(?:^|[;{\s])(?:min-|max-)?width\s*:\s*([^;]+);/g)) {
      for (const px of m[1].matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(px[1]), m[0]).toBeLessThanOrEqual(320);
    }
  });

  it('every control class has a :focus-visible style and there is a reduced-motion rule', () => {
    for (const c of ['.ctl-btn', '.ctl-input', '.ctl-range']) expect(noComments).toMatch(new RegExp(`\\${c}:focus-visible`));
    expect(noComments).toMatch(/prefers-reduced-motion/);
  });
});
