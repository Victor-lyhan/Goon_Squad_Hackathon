// #780: a direct evening journey keeps playing after the delivery while the carrier drives home (the window
// ends at the leg's finishMin, #761). The step line must not read "Journey complete" while the button still
// reads Pause: it says the package was delivered and the carrier is heading home (or to work, on a morning
// leg), then that the carrier is there; "Journey complete" only once Play has finished.
import { describe, expect, it } from 'vitest';
import {
  PAUSED_TEXT, PLAY_IDLE, playStatusText, stepAnnouncement, type PlayState,
} from '../../client/src/components/sim/v2/compose/journeyPlay';
import { buildJourney, type Journey } from '../../client/src/components/sim/v2/journey/journeyModel';
import { map, simAt } from './sim-v2-journey-sample';

const target = { shipmentId: 'shp-1', runId: 'run-1' };
const running: PlayState = { status: 'running', overnight: false, ...target };
const finished: PlayState = { status: 'finished', ...target };
// The direct sample: Ana Ruiz picks up at 17:30 (1050), delivers at Etsy 1070-1072, is home at 1110.
const direct = (t: number) => buildJourney({ shipmentId: 'shp-1', sim: simAt(t), map }) as Journey;
const relay = (t: number) => buildJourney({ shipmentId: 'shp-2', sim: simAt(t, { 'shp-2': 'delivered' }), map }) as Journey;

describe('the delivering carrier\'s end of commute, read from the last leg (#780)', () => {
  it('an evening leg ends at the carrier\'s home, a morning leg at work', () => {
    expect(direct(1000).endOfCommute).toBe('home');
    expect(relay(2000).endOfCommute).toBe('work');
  });

  it('unknown when the carrier is not in the map answer or the leg ends elsewhere', () => {
    const noEmployees = buildJourney({ shipmentId: 'shp-1', sim: simAt(1000), map: { ...map, employees: [] } }) as Journey;
    expect(noEmployees.endOfCommute).toBeNull();
    const sim = simAt(1000);
    const odd = {
      ...sim,
      plans: sim.plans.map((p) => (p.shipmentId === 'shp-1'
        ? { ...p, legs: p.legs.map((l) => ({ ...l, placeIds: ['biz-dumbo', 'biz-etsy', 'home-099'] })) } : p)),
    };
    expect((buildJourney({ shipmentId: 'shp-1', sim: odd, map }) as Journey).endOfCommute).toBeNull();
  });
});

describe('the step line of a direct evening journey after the delivery (#780)', () => {
  it('before the delivery: the next step, as before', () => {
    expect(playStatusText(direct(1060), running, 1060)).toBe('Step 2 of 2 next: Delivered to recipient at Etsy.');
  });

  it('while Play drives the carrier home: delivered, and heading home; never "Journey complete"', () => {
    for (const t of [1072, 1080, 1100, 1109]) {
      const line = playStatusText(direct(t), running, t);
      expect(line).toBe('Delivered to recipient at Etsy. Ana Ruiz is heading home.');
      expect(line).not.toMatch(/Journey complete/);
    }
  });

  it('at the leg\'s finishMin the carrier is home; still not "Journey complete" while Play runs', () => {
    expect(playStatusText(direct(1110), running, 1110)).toBe('Delivered to recipient at Etsy. Ana Ruiz is home.');
  });

  it('"Journey complete" once Play has finished (the button reads Play again)', () => {
    expect(playStatusText(direct(1110), finished, 1110)).toBe('Journey complete: Delivered to recipient at Etsy.');
  });

  it('a morning last leg says "heading to work", then "at work"', () => {
    const r = { ...running, shipmentId: 'shp-2' };
    // The sample's delivery ends at the leg's finishMin (1977); a clock before it reads "heading".
    expect(playStatusText(relay(1977), r, 1976)).toBe('Delivered to recipient at Etsy. Ben Okafor is heading to work.');
    expect(playStatusText(relay(1977), r, 1977)).toBe('Delivered to recipient at Etsy. Ben Okafor is at work.');
  });

  it('without a clock the line still says the carrier is driving on; with an unknown end it says "finishing the commute"', () => {
    expect(stepAnnouncement(direct(1080), true)).toBe('Delivered to recipient at Etsy. Ana Ruiz is heading home.');
    const unknown = { ...direct(1080), endOfCommute: null };
    expect(stepAnnouncement(unknown, true, 1080)).toBe('Delivered to recipient at Etsy. Ana Ruiz is finishing the commute.');
    expect(stepAnnouncement(unknown, true, 1110)).toBe('Delivered to recipient at Etsy. Ana Ruiz has finished the commute.');
    // Not playing (finished, or a timeline read): "Journey complete" as before.
    expect(stepAnnouncement(direct(1080))).toBe('Journey complete: Delivered to recipient at Etsy.');
  });

  it('paused and idle are unchanged', () => {
    expect(playStatusText(direct(1080), { status: 'paused', ...target }, 1080)).toBe(PAUSED_TEXT);
    expect(playStatusText(direct(1080), PLAY_IDLE, 1080)).toBe('');
  });
});
