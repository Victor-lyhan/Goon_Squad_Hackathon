// @vitest-environment jsdom
// The workspace frame and a package journey in a real DOM (#631): entering a journey opens a
// collapsed Inspector (the timeline and "Play journey" exist only there), and leaving a journey puts
// keyboard focus that fell to <body> back inside the workspace. The frame alone first, with plain
// slots; then the same two faults through the real page body.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEFT_BODY_ID, RIGHT_BODY_ID, SimWorkspace } from '../../client/src/components/sim/v2/SimWorkspace';
import type { PanelState } from '../../client/src/components/sim/v2/workspaceModel';
import { button, buttons, click, mount, press, textOf } from './kitDom';
import {
  FakeSimServer, T, journeySteps, mountBody, packageRow, panelToggle, playPause, readyState, rightBody,
} from './sim-v2-dom-helpers';

const google = vi.hoisted(() => ({ loads: 0 }));
vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: () => { google.loads += 1; },
  importLibrary: () => { google.loads += 1; return new Promise(() => {}); },
}));

beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
  google.loads = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  expect(google.loads).toBe(0);
});

const COLLAPSED_RIGHT: PanelState = { leftOpen: true, rightOpen: false };

/**
 * The frame with plain slots. The right slot has its own "Back to network" and "Play journey" only
 * during a journey, like the page's right panel; the left slot has one control that never unmounts.
 */
function mountFrame(opts: { initialPanels?: PanelState; journey?: string } = {}) {
  let title: string | null = opts.journey ?? null;
  const exits: string[] = [];
  const exit = (from: string) => () => { exits.push(from); setJourney(null); };
  const element = () => (
    <SimWorkspace
      map={<div data-testid="map" />}
      left={<button type="button" className="t-left">Next event</button>}
      right={title ? (
        <div className="t-journey">
          <button type="button">Play journey</button>
          <button type="button" onClick={exit('right')}>Back to network</button>
        </div>
      ) : <p>Run summary</p>}
      initialPanels={opts.initialPanels}
      journey={title ? { title, onExit: exit('left') } : undefined}
    />
  );
  const m = mount(element());
  function setJourney(next: string | null) {
    title = next;
    m.rerender(element());
  }
  const c = m.container;
  return {
    c, exits, setJourney,
    root: () => c.querySelector<HTMLElement>('.sim-v2')!,
    left: () => c.querySelector<HTMLElement>(`#${LEFT_BODY_ID}`)!,
    right: () => c.querySelector<HTMLElement>(`#${RIGHT_BODY_ID}`)!,
    toggle: (side: 'left' | 'right') => panelToggle(c, side),
  };
}

describe('entering a journey with the Inspector collapsed', () => {
  it('opens the Inspector, so the timeline and Play journey are on screen; the left panel is untouched', () => {
    const f = mountFrame({ initialPanels: COLLAPSED_RIGHT });
    expect(f.right().hidden).toBe(true);
    expect(f.toggle('right').getAttribute('aria-expanded')).toBe('false');

    f.setJourney('Coffee samples');
    expect(f.right().hidden).toBe(false);
    expect(f.toggle('right').getAttribute('aria-expanded')).toBe('true');
    expect(f.c.querySelector('.sw-right')!.classList.contains('is-collapsed')).toBe(false);
    expect(button(f.right(), 'Play journey').closest('[hidden]')).toBeNull();
    expect(f.left().hidden).toBe(false);
  });

  it('leaves a collapsed left panel collapsed', () => {
    const f = mountFrame({ initialPanels: { leftOpen: false, rightOpen: false } });
    f.setJourney('Coffee samples');
    expect(f.right().hidden).toBe(false);
    expect(f.left().hidden).toBe(true);
  });

  it('does not close an Inspector that is already open', () => {
    const f = mountFrame();
    f.setJourney('Coffee samples');
    expect(f.right().hidden).toBe(false);
    f.setJourney(null);
    expect(f.right().hidden).toBe(false);
  });

  it('a panel collapsed during a journey stays collapsed, also when another package is picked', () => {
    const f = mountFrame({ initialPanels: COLLAPSED_RIGHT });
    f.setJourney('Coffee samples');
    click(f.toggle('right'));
    expect(f.right().hidden).toBe(true);

    f.setJourney('Signed contracts'); // from one package to another
    expect(textOf(f.c.querySelector('.sw-journey-title')!)).toBe('Signed contracts');
    expect(f.right().hidden).toBe(true);
    f.setJourney('Signed contracts'); // a poll: the same journey again
    expect(f.right().hidden).toBe(true);
  });

  it('opens again for the next journey after a return to the network', () => {
    const f = mountFrame({ initialPanels: COLLAPSED_RIGHT });
    f.setJourney('Coffee samples');
    click(f.toggle('right'));
    f.setJourney(null);
    expect(f.right().hidden).toBe(true); // leaving a journey does not open it
    f.setJourney('Signed contracts');
    expect(f.right().hidden).toBe(false);
  });

  it('a frame that is mounted in a journey keeps the panels it was given', () => {
    const f = mountFrame({ initialPanels: COLLAPSED_RIGHT, journey: 'Coffee samples' });
    expect(f.right().hidden).toBe(true);
  });
});

describe('leaving a journey', () => {
  it('the left "Back to network": focus moves from <body> to the left panel\'s toggle', () => {
    const f = mountFrame({ journey: 'Coffee samples' });
    const back = button(f.left(), /Back to network/);
    click(back);
    expect(f.exits).toEqual(['left']);
    expect(back.isConnected).toBe(false);
    expect(document.activeElement).not.toBe(document.body);
    expect(f.root().contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(f.toggle('left'));
  });

  it('the right panel\'s "Back to network": the same', () => {
    const f = mountFrame({ journey: 'Coffee samples' });
    click(button(f.right(), 'Back to network'));
    expect(f.exits).toEqual(['right']);
    expect(document.activeElement).toBe(f.toggle('left'));
  });

  it('Esc with the focus on the page: the same', () => {
    const f = mountFrame({ journey: 'Coffee samples' });
    expect(document.activeElement).toBe(document.body);
    press('Escape', document.body);
    expect(f.exits).toEqual(['left']); // Esc calls the journey's onExit
    expect(document.activeElement).toBe(f.toggle('left'));
  });

  it('Esc from a journey button that unmounts: focus does not stay on <body>', () => {
    const f = mountFrame({ journey: 'Coffee samples' });
    const play = button(f.right(), 'Play journey');
    play.focus();
    press('Escape', play);
    expect(play.isConnected).toBe(false);
    expect(document.activeElement).toBe(f.toggle('left'));
  });

  it('with the left panel collapsed the toggle is still there to take the focus', () => {
    const f = mountFrame({ initialPanels: { leftOpen: false, rightOpen: true }, journey: 'Coffee samples' });
    click(button(f.right(), 'Back to network'));
    expect(document.activeElement).toBe(f.toggle('left'));
    expect(f.toggle('left').closest('[hidden]')).toBeNull();
  });

  it('focus on a control that is still there is left alone, inside the workspace or outside it', () => {
    const f = mountFrame({ journey: 'Coffee samples' });
    const stays = f.c.querySelector<HTMLButtonElement>('.t-left')!;
    stays.focus();
    press('Escape', stays);
    expect(f.exits).toEqual(['left']);
    expect(document.activeElement).toBe(stays);

    const outside = document.createElement('button');
    document.body.appendChild(outside);
    f.setJourney('Signed contracts');
    outside.focus();
    f.setJourney(null);
    expect(document.activeElement).toBe(outside);
  });

  it('nothing takes the focus when a journey starts, changes or was never there', () => {
    const f = mountFrame({ initialPanels: COLLAPSED_RIGHT });
    expect(document.activeElement).toBe(document.body);
    f.setJourney('Coffee samples');
    f.setJourney('Signed contracts');
    expect(document.activeElement).toBe(document.body);
  });
});

describe('the simulator page body', () => {
  const COFFEE = 'Coffee samples'; // shp-2, the relay package

  it('a package picked with the Inspector collapsed shows its timeline', () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server);
    click(panelToggle(c, 'right'));
    expect(rightBody(c).hidden).toBe(true);

    click(packageRow(c, COFFEE));
    expect(rightBody(c).hidden).toBe(false);
    expect(panelToggle(c, 'right').getAttribute('aria-expanded')).toBe('true');
    expect(journeySteps(c)).toHaveLength(4);
    expect(journeySteps(c).every((s) => s.closest('[hidden]') === null)).toBe(true);
    // #648: the one Play/Pause button is in the left panel; the journey panel has none of its own.
    expect(buttons(rightBody(c), /^(Play|Pause|Stop)/)).toHaveLength(0);
    expect(playPause(c).closest('[hidden]')).toBeNull();
  }, T);

  it('"Back to network" in either panel leaves the focus inside the workspace', () => {
    for (const where of ['.sw-journey', '.spc-journey__foot'] as const) {
      const server = new FakeSimServer(readyState(1000));
      const m = mountBody(server, { kind: 'package', id: 'shp-2' });
      const c = m.container;
      expect(buttons(c, /Back to network/)).toHaveLength(2);
      click(button(c.querySelector(where)!, /Back to network/));
      expect(server.selections).toEqual([null]);
      expect(document.activeElement, where).not.toBe(document.body);
      expect(c.querySelector('.sim-v2')!.contains(document.activeElement), where).toBe(true);
      m.unmount();
    }
  }, T);

  it('Esc from the clicked package row keeps the focus on that row', () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server);
    click(packageRow(c, COFFEE));
    press('Escape');
    expect(server.selections).toEqual([{ kind: 'package', id: 'shp-2' }, null]);
    expect(document.activeElement).toBe(packageRow(c, COFFEE));
  }, T);
});
