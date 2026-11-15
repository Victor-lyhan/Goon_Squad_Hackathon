// POST /api/v2/simulator/control through the real app: createApp -> createV2Router, with the control
// routes registered through `extraRoutes` and a real file store.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import type { Store } from '../../server/store';
import type { Run } from '../../shared/v2/types';
import { relayPlan, directPlan } from './v2-sample';
import { runWith, startControlServer, type ControlServer } from './v2-control-helpers';

const T = 10_000; // every test here talks to a real HTTP server (DECISIONS pass 19)

let server: ControlServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('POST /api/v2/simulator/control: valid controls', () => {
  it('play answers 200 with the locked, playing clock and bumps the version by one', async () => {
    server = await startControlServer(runWith({ phase: 'planning', playing: false, timeMin: 930, speed: 30 }));
    const before = server.store.get().version;

    const { status, body } = await server.control({ action: 'play' });

    expect(status).toBe(200);
    expect(body.clock).toEqual({ phase: 'locked', playing: true, timeMin: 930, speed: 30 });
    expect(body.version).toBe(before + 1);
    expect(server.store.get().version).toBe(before + 1);
    expect(server.store.get().clock).toEqual(body.clock);
  }, T);

  it('the answer is the whole SimulatorResponse for the new minute', async () => {
    server = await startControlServer(runWith({ phase: 'locked', playing: false, timeMin: 930, speed: 120 }));
    const before = server.store.get().version;

    const { status, body } = await server.control({ action: 'seek', timeMin: 1090 });

    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(
      ['clock', 'computeMs', 'jobs', 'nextEventMin', 'plans', 'runId', 'shipments', 'snapshot', 'trips', 'unmatched', 'version'],
    );
    expect(body.runId).toBe('run-3');
    expect(body.clock.timeMin).toBe(1090);
    expect(body.nextEventMin).toBe(1108);
    expect(body.plans.map((p: { id: string }) => p.id)).toEqual([relayPlan.id, directPlan.id]);
    // The snapshot is the one for the new minute and the new version, not for the minute before the control.
    expect(body.snapshot.timeMin).toBe(1090);
    expect(body.snapshot.version).toBe(before + 1);
    expect(body.snapshot.occurredEvents.map((e: { timeMin: number }) => e.timeMin)).toEqual([1052, 1072, 1082]);
    expect(server.snapshotCalls).toEqual([{ version: before + 1, timeMin: 1090 }]);
  }, T);

  it('every action works over HTTP, one version per control', async () => {
    server = await startControlServer(runWith({ phase: 'planning', playing: false, timeMin: 930, speed: 30 }));
    const start = server.store.get().version;
    const steps: [unknown, Record<string, unknown>][] = [
      [{ action: 'play' }, { phase: 'locked', playing: true, timeMin: 930, speed: 30 }],
      [{ action: 'speed', speed: 600 }, { phase: 'locked', playing: true, timeMin: 930, speed: 600 }],
      [{ action: 'pause' }, { phase: 'locked', playing: false, timeMin: 930, speed: 600 }],
      [{ action: 'next_event' }, { phase: 'locked', playing: false, timeMin: 1052, speed: 600 }],
      [{ action: 'jump_to_morning' }, { phase: 'locked', playing: false, timeMin: 1925, speed: 600 }],
      [{ action: 'seek', timeMin: 2160 }, { phase: 'locked', playing: false, timeMin: 2160, speed: 600 }],
      [{ action: 'seek', timeMin: 930 }, { phase: 'locked', playing: false, timeMin: 930, speed: 600 }],
      [{ action: 'finish' }, { phase: 'locked', playing: false, timeMin: 2160, speed: 600 }],
      // "Back to start" is the one control that unlocks (#734).
      [{ action: 'reset_playback' }, { phase: 'planning', playing: false, timeMin: 930, speed: 600 }],
    ];
    for (const [i, [request, clock]] of steps.entries()) {
      const { status, body } = await server.control(request);
      expect(status).toBe(200);
      expect(body.clock).toEqual(clock);
      expect(body.version).toBe(start + i + 1);
      expect(body.snapshot.timeMin).toBe(clock.timeMin);
    }
    // the state file holds the last clock
    await server.store.flush();
    const saved = JSON.parse(fs.readFileSync(server.stateFile, 'utf8'));
    expect(saved.run.clock).toEqual({ phase: 'planning', playing: false, timeMin: 930, speed: 600 });
    expect(saved.run.version).toBe(start + steps.length);
  }, T);

  it('"Play journey": 2-minute seek steps sent together all land, one version each', async () => {
    server = await startControlServer(runWith({ phase: 'locked', playing: false, timeMin: 1050, speed: 30 }));
    const start = server.store.get().version;
    const minutes = [1052, 1054, 1056, 1058, 1060, 1062, 1064, 1066];

    const answers = await Promise.all(minutes.map((timeMin) => server!.control({ action: 'seek', timeMin })));

    for (const [i, { status, body }] of answers.entries()) {
      expect(status).toBe(200);
      expect(body.clock.timeMin).toBe(minutes[i]);
      expect(body.snapshot.timeMin).toBe(minutes[i]);
    }
    expect(answers.map((a) => a.body.version).sort((a, b) => a - b)).toEqual(minutes.map((_m, i) => start + i + 1));
    expect(server.store.get().version).toBe(start + minutes.length);
  }, T);

  it('the control is planned on the run inside the mutation, so a tick queued before it is not undone', async () => {
    // A store whose get() is one tick behind: a route that planned from get() would rewind the clock to 1000.
    const stale = runWith({ phase: 'locked', playing: true, timeMin: 1000, speed: 30 });
    const behind = (real: Store<Run>): Store<Run> => ({ ...real, get: () => stale });
    server = await startControlServer(runWith({ phase: 'locked', playing: true, timeMin: 1000, speed: 30 }), behind);
    await server.store.mutate((run) => {
      run.clock.timeMin = 1030; // the tick
    });

    const { status, body } = await server.control({ action: 'pause' });

    expect(status).toBe(200);
    expect(body.clock).toEqual({ phase: 'locked', playing: false, timeMin: 1030, speed: 30 });
    expect(server.store.get().clock.timeMin).toBe(1030);
  }, T);
});

describe('POST /api/v2/simulator/control: bad requests', () => {
  it.each([
    ['an unknown action', { action: 'rewind' }, 'action'],
    ['an empty object', {}, 'action'],
    ['a speed that is not offered', { action: 'speed', speed: 60 }, 'speed'],
    ['a seek one minute before the start', { action: 'seek', timeMin: 929 }, 'timeMin'],
    ['a seek one minute after the end', { action: 'seek', timeMin: 2161 }, 'timeMin'],
    ['a seek to half a minute', { action: 'seek', timeMin: 1000.5 }, 'timeMin'],
    ['no body', undefined, 'body'],
  ])('%s -> 400 with fieldErrors.%s, and nothing changes', async (_name, request, field) => {
    server = await startControlServer(runWith({ phase: 'planning', playing: false, timeMin: 1000, speed: 30 }));
    const before = server.store.get();

    const { status, body } = await server.control(request);

    expect(status).toBe(400);
    expect(Object.keys(body).sort()).toEqual(['error', 'fieldErrors']);
    expect(body.error).toBe('Invalid simulator control');
    expect(Object.keys(body.fieldErrors)).toEqual([field]);
    await server.store.flush();
    expect(server.store.get()).toBe(before); // same object: no mutation happened
    expect(server.store.get().version).toBe(before.version);
    expect(server.store.get().clock).toEqual({ phase: 'planning', playing: false, timeMin: 1000, speed: 30 });
    expect(fs.existsSync(server.stateFile)).toBe(false); // nothing was written either
    expect(server.snapshotCalls).toEqual([]);
  }, T);

  it('the seek message names the run\'s bounds', async () => {
    server = await startControlServer(runWith());
    const { body } = await server.control({ action: 'seek', timeMin: 2161 });
    expect(body.fieldErrors).toEqual({ timeMin: 'Must be between 930 and 2160' });
  }, T);

  it('malformed JSON -> the app\'s JSON 400, version unchanged', async () => {
    server = await startControlServer(runWith());
    const before = server.store.get().version;
    const { status, body } = await server.control('{"action": "play"');
    expect(status).toBe(400);
    expect(body).toEqual({ error: 'Request body is not valid JSON' });
    expect(server.store.get().version).toBe(before);
  }, T);

  it('a refused control does not block the next one', async () => {
    server = await startControlServer(runWith({ phase: 'locked', playing: false, timeMin: 1000, speed: 30 }));
    const before = server.store.get().version;
    expect((await server.control({ action: 'seek', timeMin: 5 })).status).toBe(400);
    const { status, body } = await server.control({ action: 'seek', timeMin: 1001 });
    expect(status).toBe(200);
    expect(body.clock.timeMin).toBe(1001);
    expect(body.version).toBe(before + 1);
  }, T);

  it('only POST is registered: GET /simulator/control is the JSON 404', async () => {
    server = await startControlServer(runWith());
    const res = await server.raw('GET');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  }, T);
});
