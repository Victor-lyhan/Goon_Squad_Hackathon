import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { headerModel } from '../../client/src/components/business/v2/activity/activityModel';
import { NEEDS_INPUT_HINT, RESULT_COPY } from '../../client/src/components/business/v2/newDeliveryModel';
import { NEW_DELIVERY_CLOSED_TEXT } from '../../client/src/components/business/v2/page/businessPageModel';
import { UNAVAILABLE_TEXT as ADDRESS_SEARCH_NEEDS_KEY_TEXT } from '../../client/src/components/employee/v2/addressSearchModel';
import { LOCKED_TEXT } from '../../client/src/components/employee/v2/employeeWorkspaceModel';
import { TRAVEL_DATA_MISSING_TEXT } from '../../client/src/components/employee/v2/live/employeeWorkspaceState';
import { NETWORK_OVERNIGHT_TEXT } from '../../client/src/components/sim/v2/compose/journeyPlay';
import { FINISHED_REASON, RESET_LABEL } from '../../client/src/components/sim/v2/controls/controlsModel';
import { DEFAULT_V2_STATE_PATH, sourcePathFor } from '../../server/api/v2/bootRun';
import { SERVER_KEY_NAME } from '../../server/geo/env';
import {
  CHECK_KEY_LINE, CHECK_LINE, DROP_ENTERED_COMMAND, EXIT_INCOMPLETE, EXIT_OK, EXIT_USAGE, RESUME_LINE, parseArgs, refetchCommand,
} from '../../server/geo/fetchScript';
import { formatKeyCheck } from '../../server/geo/keyCheck';
import {
  CLIENT_MISSING_LINE, CLIENT_SERVED_LINE, KEY_NOT_SET_LINE, KEY_SET_LINE, portInUseMessage, STATE_PATH_NAME, stateStartLine,
} from '../../server/index';

const root = path.resolve(__dirname, '../..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
  engines?: { node?: string };
};

const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
/** A `## ` section of the README, heading included, up to the next `## ` heading. */
function sectionOf(heading: string): string {
  const start = readme.indexOf(`\n${heading}\n`);
  if (start === -1) return '';
  const next = readme.indexOf('\n## ', start + 1);
  return readme.slice(start, next === -1 ? undefined : next);
}
const BROWSER_KEY_NAME = 'VITE_GOOGLE_MAPS_BROWSER_KEY';
// `/help` is no longer a route (#623) and the README no longer has its row (#703).
const MAIN_PATHS = ['/', '/business/<id>', '/employee/<id>', '/simulator'];

describe('README', () => {
  it('only references npm scripts that exist', () => {
    const used = [...readme.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) expect(Object.keys(pkg.scripts), `npm run ${name}`).toContain(name);
    // The fetch command is one of them, so a rename in package.json fails here.
    expect(used).toContain('fetch:routes');
    expect(Object.keys(pkg.scripts)).toContain('fetch:routes');
  });

  it('documents the setup scripts', () => {
    for (const s of ['dev', 'build']) expect(readme).toContain(`npm run ${s}`);
  });

  it('mentions the state file and ports', () => {
    expect(readme).toContain('data/state-v2.json');
    expect(readme).toContain('3001');
    expect(readme).toContain('5173');
  });

  it('holds nothing that looks like a real Google key', () => {
    const lines = readme.split(/\r?\n/);
    const leaks = lines.flatMap((line, i) => (/AIza[0-9A-Za-z_-]{30,}/.test(line) ? [i + 1] : []));
    expect(leaks, 'README line numbers that look like a key').toEqual([]);
  });
});

// #569: the README describes the app a judge gets from a fresh clone after the cutover (#548).
describe('README after the cutover', () => {
  /** Everything above the first `## ` heading. */
  const intro = readme.slice(0, readme.indexOf('\n## '));

  it('opens with Relay on real NYC locations with simulated deliveries', () => {
    expect(intro).toMatch(/^# Relay\n/);
    expect(intro).toMatch(/Real NYC locations, simulated deliveries/);
    expect(intro).toContain('relay point');
    expect(intro).toContain('`fixtures/nyc/`');
    expect(intro).toMatch(/shown by neighborhood only/);
  });

  it('no longer describes the synthetic city, hubs or the MVP 1 app', () => {
    for (const gone of [/synthetic city/i, /\bhubs?\b/i, /no external APIs/i, /MVP 1\b/, /MVP II\b/, /Demo city/, /preview pages/i]) {
      expect(readme, String(gone)).not.toMatch(gone);
    }
    // The MVP 1 API and its state file still exist until their deletion step; the README does not document them.
    expect(readme).not.toMatch(/data\/state\.json/);
    expect(readme).not.toContain('demo-script.test.ts');
    expect(fs.existsSync(path.join(root, 'tests/api/demo-script.test.ts'))).toBe(false);
  });

  it('says what works with no key, what the browser key adds and what the server key adds', () => {
    const section = sectionOf('## What works with and without a key');
    expect(section).not.toBe('');
    expect(readme.indexOf('## What works with and without a key')).toBeLessThan(readme.indexOf('## Requirements'));
    const row = (label: string) => section.split('\n').find((line) => line.startsWith(`| **${label}**`)) ?? '';

    const none = row('No key');
    expect(none).toMatch(/fresh clone/);
    expect(none).toMatch(/[Ee]verything in the 2-minute demo/);
    expect(none).toMatch(/committed cache/);
    expect(none).toMatch(/commute save that keeps the home/);
    // The sentence the map area shows without a browser key.
    const mapModel = read('client/src/components/map/mapModel.ts');
    const keyMissing = /KEY_MISSING_TEXT = '([^']+)'/.exec(mapModel)?.[1];
    expect(keyMissing).toBeTruthy();
    expect(none).toContain(`"${keyMissing}"`);

    const browser = row('Browser key');
    expect(browser).toContain(`\`${BROWSER_KEY_NAME}\``);
    expect(browser).toMatch(/Google map/);
    expect(browser).not.toContain(SERVER_KEY_NAME);

    const server = row('Server key');
    expect(server).toContain(`\`${SERVER_KEY_NAME}\``);
    expect(server).toMatch(/commute save with a new address/);
    expect(server).toContain('`npm run fetch:routes`');
    expect(server).not.toContain(BROWSER_KEY_NAME);

    // No key is required anywhere.
    expect(sectionOf('## Requirements')).toMatch(/No API key or environment variable is needed/);
  });

  it('lists the main paths, and they are the routes the app mounts', () => {
    const setup = sectionOf('## Setup and run');
    const app = read('client/src/App.tsx');
    for (const p of MAIN_PATHS) {
      expect(setup, `the row of ${p}`).toMatch(new RegExp(`^\\| \`${p.replace(/[<>/]/g, '\\$&')}\` \\|`, 'm'));
      expect(app, `the route of ${p}`).toContain(`path="${p.replace('<id>', ':id')}"`);
    }
  });

  // #877: the homepage after #869 (the hero fills the window under the header, the drawn map is its right
  // half, Business and Employee are stacked under Watch a package). Each claim is read from the page's CSS and JSX.
  it('describes the homepage as it is: a hero that fills the screen under the header, text on the left, the drawn map on the right', () => {
    const row = sectionOf('## Setup and run').split('\n').find((line) => line.startsWith('| `/` |')) ?? '';
    expect(row).toContain('Homepage: a dark hero that fills the screen under the header.');
    expect(row).toContain(
      'Its left half has the title, the **Watch a package** button (it opens the simulator on an example package and plays it) and, '
      + 'stacked under the button, the **Business** and **Employee** entries.',
    );
    expect(row).toContain('Its right half is a drawn map of New York on which a package is relayed in a loop (an illustration, not a run; no map key needed).');
    expect(row).toContain('Scroll down for **How it works** in three lines with the **See the numbers** button to `/study.html`.');
    expect(row).toContain('In a narrow or upright window the map lies under the text.');

    const css = read('client/src/styles/landing.css');
    const rule = (selector: string) => new RegExp(`\\n\\${selector} \\{[^}]*\\}`).exec(css)?.[0] ?? '';
    // "fills the screen under the header": the window's height less the header's, which the shell sets.
    // The fallback is the header's own height (#879); the 100vh line is for a browser without dvh.
    expect(rule('.landing-hero')).toContain('min-height: calc(100vh - var(--app-header-h, 64px));');
    expect(rule('.landing-hero')).toContain('min-height: calc(100dvh - var(--app-header-h, 64px));');
    expect(read('client/src/ui/shell.css')).toContain(':root { --app-header-h: 64px; }');
    // "dark", and two halves: the text column and the map.
    expect(rule('.landing-hero')).toContain('background: var(--hero-ground, #171C24);');
    expect(rule('.landing-hero')).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);');
    expect(rule('.landing-hero-map')).toContain('grid-column: 2;');
    // "stacked": the two entries are one column, and the button comes before them in the text column.
    expect(rule('.workspaces')).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(rule('.landing-hero-copy')).toContain('flex-direction: column;');
    const page = read('client/src/pages/Landing.tsx');
    const order = ['<LandingTitle />', '<WatchButton to=', '<WorkspaceEntries paths=', '<LandingHeroMap />', '<HowItWorks />'].map((jsx) => page.indexOf(jsx));
    expect(order.every((index) => index > 0), 'the five parts of the page').toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // "In a narrow or upright window the map lies under the text": the second row of a one-column hero.
    const narrow = css.slice(css.indexOf('@media (max-width: 820px), (max-aspect-ratio: 6/5) {'));
    expect(narrow).toContain('.landing-hero { grid-template-columns: minmax(0, 1fr);');
    expect(narrow).toContain('.landing-hero-map { --hero-fade: to bottom; grid-column: 1; grid-row: 2; }');
  });

  // #877: the header after #854 (no line of text at its top right) and #868 (a 64 px bar, the links centered).
  it('describes the header as it is: a 64 px bar with the logo, the three links and, on account pages only, the Demo account selector', () => {
    const line = sectionOf('## Setup and run').split('\n').find((text) => text.startsWith('The header is one bar on every page')) ?? '';
    expect(line).toBe(
      'The header is one bar on every page, 64 px high in a desktop window: the Relay logo at the left (it opens the homepage), '
      + 'the **Business**, **Employee** and **Simulator** links in the middle and, on the Business and Employee pages only, '
      + 'the **Demo account** selector at the right. It shows nothing else.',
    );
    const shell = read('client/src/ui/shell.css');
    expect(/:root \{ --app-header-h: (\d+)px; \}/.exec(shell)?.[1]).toBe('64');
    // Left, middle, right: the three columns of the header's grid, in the order App.tsx draws them.
    expect(shell).toContain('grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);');
    const app = read('client/src/App.tsx');
    const parts = ['<Link to={HOME_PATH} className="shell-wordmark">', '<nav aria-label="Workspaces" className="shell-nav">', '<div className="shell-tools">']
      .map((jsx) => app.indexOf(jsx));
    expect(parts.every((index) => index > 0), 'logo, links and selector in App.tsx').toBe(true);
    expect(parts).toEqual([...parts].sort((a, b) => a - b));
    const model = read('client/src/ui/shellModel.ts');
    for (const label of ['Business', 'Employee', 'Simulator']) expect(model).toContain(`label: '${label}'`);
    expect(model).toContain("HOME_PATH = '/'");
    // "It shows nothing else": the line "Real NYC locations · simulated deliveries" left the header (#854).
    expect(app).not.toContain('shell-env');
    expect(model).not.toContain('ENV_INDICATOR_TEXT');
    expect(readme).not.toMatch(/Real NYC locations · simulated deliveries/);
    // "on the Business and Employee pages only", as the Demo accounts section says too.
    expect(sectionOf('## Demo accounts')).toMatch(/the homepage and the Simulator do not show it/);
  });

  it('names /nyc only as a redirect', () => {
    // `/nyc` as a path of the app, not the folder fixtures/nyc.
    const lines = readme.split('\n').filter((line) => /(?<![\w.-])\/nyc\b/.test(line));
    for (const line of lines) expect(line).toMatch(/redirect/);
    expect(read('client/src/App.tsx')).toMatch(/path="\/nyc\/\*" element=\{<CutoverRedirect \/>\}/);
  });

  it('state and reset name data/state-v2.json, and keep the paragraph on a changed story', () => {
    const state = sectionOf('## State file and reset');
    expect(DEFAULT_V2_STATE_PATH).toBe(path.join(root, 'data', 'state-v2.json')); // the file the server writes
    expect(path.relative(root, sourcePathFor(DEFAULT_V2_STATE_PATH))).toBe(path.join('data', 'state-v2.source.json'));
    expect(state).toContain('`data/state-v2.json`');
    expect(state).toMatch(/delete `data\/state-v2\.json` and start it again/);
    expect(state).toMatch(/restores it, paused/);
    // DECISIONS pass 55 (#503): a changed story or default limit starts a fresh run at the next restart,
    // the old run is kept, and the fingerprint is in the sidecar file.
    const stale = state.split('\n').find((line) => line.startsWith('A changed story or default limit')) ?? '';
    expect(stale).toMatch(/starts a fresh run at the next restart/);
    for (const file of ['businesses.json', 'neighborhoods.json', 'demoStory.json']) expect(stale).toContain(file);
    expect(stale).toContain('`data/state-v2.json.stale-<n>`');
    expect(stale).toMatch(/never deleted/);
    expect(stale).toContain('`data/state-v2.source.json`');
    expect(stale).toMatch(/travel cache is not part of it/);
    // #648 (docs/mvp3.md P2): the simulator's Planning cycle section is gone. #734 (DECISIONS pass 74):
    // "Back to start" unlocks the run, so the README says what locks it and names that button, not a reset.
    expect(state).not.toContain('Start new planning cycle');
    expect(fs.existsSync(path.join(root, 'client/src/components/sim/v2/controls/PlanningControls.tsx'))).toBe(false);
    // #815 (after #790, DECISIONS pass 84): Play with no package picked steps the clock with seeks, like a
    // journey, so it no longer locks the run. The paragraph quotes the page's own lines.
    const play = state.split('\n').find((line) => line.startsWith('In the Simulator, **Play** with no package picked')) ?? '';
    expect(play).toMatch(/\*\*Play\*\* with no package picked plays every carrier's commute.*and does not lock the run/);
    expect(state).not.toMatch(/runs the whole network and locks the run/);
    expect(play).toContain(`"${NETWORK_OVERNIGHT_TEXT}" card`);
    expect(play).toContain(`"${FINISHED_REASON}"`);
    expect(FINISHED_REASON).toContain(`Use ${RESET_LABEL} to`);
    expect(play).toMatch(/New deliveries and commute changes stay open while it plays and after it/);
    expect(play).toMatch(/Playing one package's journey does not lock the run either/);
    // No file of the client sends the `play` control: the pages step with `seek`, pause and reset.
    const sends = (dir: string): string[] => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return sends(rel);
      return /\.tsx?$/.test(entry.name) && /action:\s*['"]play['"]/.test(read(rel)) ? [rel] : [];
    });
    expect(sends('client/src'), "client files that send { action: 'play' }").toStrictEqual([]);
    // Only the API's `play` control locks (server/api/v2/controlOps.ts), and the README names it.
    const lock = state.split('\n').find((line) => line.startsWith('No button of the pages locks the run.')) ?? '';
    expect(lock).toContain('Only the `play` control of the API does (`POST /api/v2/simulator/control` with the body `{"action":"play"}`)');
    expect(read('server/api/v2/controlOps.ts')).toMatch(/`play` locks the run and `reset_playback` \("Back to start"\) returns it to `planning`/);
    expect(state).toMatch(/\*\*Back to start\*\* in the Simulator unlocks it/);
    expect(state).not.toMatch(/reset as above to unlock it/);
    expect(RESET_LABEL).toBe('Back to start'); // the button's own label
    // #756: the locked lines are quoted as the pages print them (#742, #745), and both name the button.
    expect(NEW_DELIVERY_CLOSED_TEXT).toBe(RESULT_COPY.locked); // the Business page's line is the form's text
    for (const text of [RESULT_COPY.locked, LOCKED_TEXT]) {
      expect(text).toContain(`${RESET_LABEL} in the simulator`);
      expect(lock, text).toContain(`"${text}"`);
    }
    expect(lock.indexOf(`"${RESULT_COPY.locked}"`)).toBeLessThan(lock.indexOf(`"${LOCKED_TEXT}"`)); // Business, then Employee
    expect(lock).toMatch(/The Business page then says "Locked", its \*\*New delivery\*\* button is disabled/);
    expect(headerModel({ business: {}, totals: {}, phase: 'locked' } as never).phaseLabel).toBe('Locked');
    expect(lock).toMatch(/On the Employee page \*\*Edit commute\*\* is disabled/);
    expect(lock).toMatch(/No reset is needed\./);
    expect(lock).toMatch(/\*\*Pause\*\* does not unlock it, and neither does a restart/);
    // The old sentence about the pages' wording is gone, here and everywhere else in the file.
    expect(readme).not.toMatch(/planning cycle/i);
    // #727: a second server's own state file, with its start line in the words of server/index.ts.
    const example = new RegExp(`\`${STATE_PATH_NAME}=(\\S+) PORT=3002 npm start\``).exec(state)?.[1] ?? '';
    expect(example).toMatch(/^\/tmp\/.+\.json$/);
    expect(state).toContain(`"${stateStartLine(example, DEFAULT_V2_STATE_PATH)}"`);
    expect(stateStartLine(DEFAULT_V2_STATE_PATH, DEFAULT_V2_STATE_PATH)).toBeNull(); // the default file gets no line
  });

  // #756: rehearsing and the demo share one run. What the sentences claim was seen on a real server
  // (`RELAY_STATE_PATH=... PORT=... npm start`, the README request three times over HTTP, PR #749 and #756).
  // Since #966 the default run has 60 more employees, so the request is matched four times, and
  // tests/api/v2-story-first-routes.test.ts sends it until it is not and reads the count from this sentence.
  it('2-minute demo: says a rehearsal that ran Find a delivery match needs a reset, and one of Play, Back to start and a journey does not', () => {
    const demo = sectionOf('## 2-minute demo');
    const note = demo.split('\n').find((line) => line.startsWith('Rehearsing and the demo share one run.')) ?? '';
    expect(note).not.toBe('');
    // Before the numbered steps, after the request block.
    expect(demo.indexOf(note)).toBeGreaterThan(demo.indexOf('```demo-request'));
    expect(demo.indexOf(note)).toBeLessThan(demo.indexOf('\n1. **Employee**'));
    expect(note).toContain(
      'Use a fresh run for the real demo: the request is planned on commutes that are still free, and a rehearsal that chose '
      + '**Find a delivery match** uses them up, so reset the run after it ([State file and reset](#state-file-and-reset)).',
    );
    expect(readme).toContain('\n## State file and reset\n'); // the heading the link points at
    expect(note).toContain(
      'One run arranges the request as the block says once: sent again it comes with other carriers than the block names, '
      + 'and the fifth time it is not matched ("Every matching commute is already carrying a package").',
    );
    // The reason is the matcher's own sentence.
    const reason = /not matched \("([^"]+)"\)/.exec(note)?.[1] ?? 'no reason quoted';
    expect(read('server/domain/v2/matching.ts')).toContain(`'${reason}'`);
    expect(note).toContain(`A rehearsal of only **Play**, **${RESET_LABEL}** and a package's journey adds no delivery and needs no reset.`);
    // The older "after an earlier try, reset first" is replaced, and the way out of a locked run is still there.
    expect(demo).not.toMatch(/after an earlier try/);
    // #815: no page's Play locks the run any more, so the line on a locked run became a paragraph on the
    // clock: Back to start before step 2, because a watched journey or Play leaves the clock on Day 2.
    expect(demo).not.toMatch(/the run is locked and the \*\*New delivery\*\* button is disabled/);
    const clock = demo.split('\n').find((line) => line.startsWith(`Press **${RESET_LABEL}** in the Simulator before step 2`)) ?? '';
    expect(clock).not.toBe('');
    expect(demo.indexOf(clock)).toBeGreaterThan(demo.indexOf(note));
    expect(demo.indexOf(clock)).toBeLessThan(demo.indexOf('\n1. **Employee**'));
    expect(clock).toContain(`"${NEEDS_INPUT_HINT}"`); // the hint of the form's field, as the page prints it
    expect(clock).toMatch(/An earlier \*\*Play\*\* does not close \*\*New delivery\*\*/);
    expect(clock).toContain(`Should the Business page say "Locked" all the same, **${RESET_LABEL}** reopens it ([State file and reset](#state-file-and-reset)).`);
  });

  it('the repository layout names folders and files that exist', () => {
    const layout = sectionOf('## Repository layout');
    const rows = layout.split('\n').filter((line) => line.startsWith('- '));
    expect(rows.length).toBeGreaterThanOrEqual(6);
    const check = (rel: string) => expect(fs.existsSync(path.join(root, rel)), `${rel} exists`).toBe(true);
    for (const top of ['client/', 'server/', 'shared/', 'fixtures/nyc/', 'scripts/fetch-routes.ts', 'tests/', 'docs/']) {
      expect(layout).toContain(`\`${top}\``);
      check(top);
    }
    // [what the row says, the path it stands for]
    const named: [text: string, rel: string][] = [
      ['`src/pages`', 'client/src/pages'], ['`src/components`', 'client/src/components'], ['`src/ui`', 'client/src/ui'],
      ['`src/api`', 'client/src/api'], ['`business/`', 'client/src/components/business'],
      ['`employee/`', 'client/src/components/employee'], ['`sim/`', 'client/src/components/sim'],
      ['`map/`', 'client/src/components/map'], ['`api/v2/`', 'server/api/v2'], ['`domain/v2/`', 'server/domain/v2'],
      ['`geo/`', 'server/geo'], ['`shared/v2/`', 'shared/v2'], ['`api/`', 'tests/api'], ['`domain/`', 'tests/domain'],
      ['`geo/`', 'tests/geo'], ['`ui/`', 'tests/ui'], ['`relay-spec.md`', 'docs/relay-spec.md'],
      ['`mvp2-ui-redesign.md`', 'docs/mvp2-ui-redesign.md'], ['`mvp3.md`', 'docs/mvp3.md'], ['`SPEC.md`', 'SPEC.md'], ['`DECISIONS.md`', 'DECISIONS.md'],
      ['`AGENTS.md`', 'AGENTS.md'],
      ...['businesses.json', 'neighborhoods.json', 'demoStory.json', 'matrix.json', 'polylines.json']
        .map((file): [string, string] => [`\`${file}\``, `fixtures/nyc/${file}`]),
    ];
    for (const [text, rel] of named) {
      expect(layout, `${text} in the layout`).toContain(text);
      check(rel);
    }
    // Every backticked name of the section is one of the above: nothing is listed that was not checked.
    const listed = new Set([...layout.matchAll(/`([^`]+)`/g)].map((m) => m[1]));
    const known = new Set([
      'client/', 'server/', 'shared/', 'fixtures/nyc/', 'scripts/fetch-routes.ts', 'tests/', 'docs/', 'npm run fetch:routes',
      ...named.map(([text]) => text.slice(1, -1)),
    ]);
    expect([...listed].filter((name) => !known.has(name))).toStrictEqual([]);
  });

  it('assumptions and out of scope follow SPEC\'s MVP II rules', () => {
    const section = sectionOf('## Assumptions and out of scope');
    // Rules 1, 3, 4, 5, 6 and the travel provider's rounding.
    for (const api of ['Routes API', 'Geocoding API', 'Maps JavaScript API']) expect(section).toContain(api);
    expect(section).toMatch(/and no others/);
    expect(section).toMatch(/committed cache/);
    expect(section).toContain('TRAFFIC_UNAWARE');
    expect(section).toContain('DRIVE');
    expect(section).toMatch(/rounded up to whole minutes/);
    expect(section).toMatch(/only at network businesses, never at homes/);
    expect(section).toMatch(/Every network business can be a relay point/);
    expect(section).toMatch(/shown by neighborhood only/);
    expect(section).toMatch(/Never a real person's address/);
    expect(section).toMatch(/No time or distance is ever estimated/);
    const out = section.split('\n').find((line) => line.startsWith('- Out of scope:')) ?? '';
    for (const item of ['cancellations', 'auth', 'real payments', 'GPS', 'QR scanning', 'LLM/runtime AI', 'WebSockets', 'databases']) {
      expect(out).toContain(item);
    }
    expect(out).not.toMatch(/external APIs/); // allowed since MVP II
  });
});

// ---------- #637: the Node version, PORT and the start lines ----------

type Version = [major: number, minor: number, patch: number];
/** "22", "22.12" or "22.12.0" as three numbers. Anything else throws, so an unexpected format fails the test. */
function version(text: string): Version {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(text.trim());
  if (!m) throw new Error(`not a version: "${text}"`);
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}
const compare = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
/** One alternative of an `engines.node` range: `>=a.b.c` (no upper end) or `^a.b.c` (below the next major). */
type Span = { from: Version; belowMajor: number | null };
/** The `||` alternatives of a range written with `>=` and `^` only, which is all the packages read here use. */
function spans(range: string): Span[] {
  return range.split('||').map((part) => {
    const m = /^(>=|\^)\s*(\S+)$/.exec(part.trim());
    if (!m) throw new Error(`engines range "${range}": "${part.trim()}" is neither >=x nor ^x`);
    const from = version(m[2]);
    return { from, belowMajor: m[1] === '^' ? from[0] + 1 : null };
  });
}
const satisfies = (v: Version, range: string) =>
  spans(range).some((span) => compare(v, span.from) >= 0 && (span.belowMajor === null || v[0] < span.belowMajor));
/** The lowest version inside every range. It is the start of one of their alternatives. */
function lowest(ranges: string[], major?: number): Version {
  const starts = ranges.flatMap((range) => spans(range).map((span) => span.from));
  const inside = starts.filter((v) => (major === undefined || v[0] === major) && ranges.every((range) => satisfies(v, range)));
  if (inside.length === 0) throw new Error(`no Node version satisfies all of: ${ranges.join(' ; ')}`);
  return inside.sort(compare)[0];
}

describe('README for a fresh clone: Node version, ports and start lines (#637)', () => {
  const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, { engines?: { node?: string } }> };
  /** The `engines.node` of a direct dependency, as the lock file has it. */
  const enginesOf = (name: string) => {
    const range = lock.packages[`node_modules/${name}`]?.engines?.node;
    if (!range) throw new Error(`package-lock.json has no engines.node for ${name}`);
    return range;
  };
  const own = pkg.engines?.node ?? '>=0';
  const requirements = sectionOf('## Requirements');
  const bullet = (what: string) => requirements.split('\n').find((line) => line.startsWith('- Node.js') && line.includes(what)) ?? '';
  /** Every "<version> or newer" of a line. */
  const named = (line: string) => [...line.matchAll(/(\d+(?:\.\d+){0,2}) or newer/g)].map((m) => version(m[1]));

  it('the range reader knows a version below, inside and between the alternatives of a range', () => {
    const sample = '^20.19.0 || >=22.12.0';
    expect(satisfies(version('20.18.9'), sample)).toBe(false);
    expect(satisfies(version('20.19'), sample)).toBe(true);
    expect(satisfies(version('21.5.0'), sample)).toBe(false);
    expect(satisfies(version('22.11.0'), sample)).toBe(false);
    expect(satisfies(version('22.12.0'), sample)).toBe(true);
    expect(satisfies(version('26'), sample)).toBe(true);
    expect(lowest([sample, '>=22'])).toEqual([22, 12, 0]);
    expect(lowest([sample, '>=18'])).toEqual([20, 19, 0]);
    expect(() => spans('20 || >=22')).toThrow(/neither/);
  });

  it('names a Node version for running the app that Vite accepts, and it is the lowest one', () => {
    const line = bullet('to run the app');
    const [appVersion, ...more] = named(line);
    expect(appVersion, 'a "- Node.js <version> or newer to run the app" line in Requirements').toBeDefined();
    expect(more).toEqual([]);
    const ranges = [own, enginesOf('vite')];
    // Fails when the README names a version below what vite's engines in the lock file allow.
    for (const range of ranges) expect(satisfies(appVersion, range), `Node ${appVersion.join('.')} in "${range}"`).toBe(true);
    expect(appVersion).toEqual(lowest(ranges));
    for (const command of ['`npm run dev`', '`npm run build`', '`npm start`']) expect(line).toContain(command);
    expect(line).toContain('`package-lock.json`');
    // The old line is gone: plain "22 or newer" is below Vite's range.
    expect(readme).not.toMatch(/Node\.js \d+ or newer \(`engines` in `package\.json`\)/);
  });

  it('names the higher Node version vitest and jsdom need for the tests', () => {
    const line = bullet('to run the tests');
    const versions = named(line);
    const ranges = [own, enginesOf('vite'), enginesOf('vitest'), enginesOf('jsdom')];
    const needed = lowest(ranges);
    // The README has this second line only when the tests need more than the app does.
    if (compare(needed, lowest([own, enginesOf('vite')])) === 0) {
      expect(line).toBe('');
      return;
    }
    expect(versions.length, 'a "- Node.js <version> or newer to run the tests" line in Requirements').toBeGreaterThan(0);
    for (const v of versions) {
      for (const range of ranges) expect(satisfies(v, range), `Node ${v.join('.')} in "${range}"`).toBe(true);
      // Each one is the lowest of its major, so "24.15 or newer" is not a guess either.
      expect(v).toEqual(lowest(ranges, v[0]));
    }
    expect(versions[0]).toEqual(needed);
    expect(line).toContain('`bash scripts/test.sh`');
    expect(line).toMatch(/vitest and jsdom/);
    // "vitest does not list Node 23 or 25": true for the range in the lock file.
    for (const major of [...line.matchAll(/Node (\d+) or (\d+)/g)].flatMap((m) => [m[1], m[2]])) {
      expect(satisfies(version(`${major}.99.99`), enginesOf('vitest')), `vitest on Node ${major}`).toBe(false);
    }
  });

  it('says PORT applies to npm start only, and that npm run dev needs ports 3001 and 5173 free', () => {
    expect(requirements).toMatch(/`PORT` is optional and applies to `npm start` only \(default `3001`\)/);
    const setup = sectionOf('## Setup and run');
    expect(setup).toMatch(/`npm run dev` needs ports 3001 and 5173 free/);
    expect(setup).toMatch(/Do not set `PORT`/);
    // The cause, in the config the README describes: the proxy target and Vite's port are fixed.
    const vite = read('vite.config.ts');
    expect(vite).toContain("proxy: { '/api': 'http://localhost:3001' }");
    expect(vite).toMatch(/port: 5173,\s*strictPort: true/);
    // The server's own message offers another PORT, which is right for npm start only.
    expect(portInUseMessage(3001)).toContain('PORT=3002');
    expect(setup).toMatch(/already in use, stop the other server/);
    const production = sectionOf('## Production build');
    expect(production).toContain('`PORT=3002 npm start`');
    expect(readme).not.toMatch(/PORT=\d+ npm run dev/);
  });

  it('names the start lines of npm start in the words of server/index.ts', () => {
    const production = sectionOf('## Production build');
    const sentence = production.split('\n').find((line) => line.startsWith('When it starts, `npm start` prints')) ?? '';
    for (const line of [CLIENT_SERVED_LINE, CLIENT_MISSING_LINE, KEY_SET_LINE, KEY_NOT_SET_LINE]) {
      expect(sentence, line).toContain(`"${line}"`);
    }
    expect(sentence).toMatch(/the key itself is never printed/);
  });

  it('holds no coordinate: no number with four or more decimals and no entered-home ID', () => {
    const lines = readme.split(/\r?\n/);
    const found = lines.flatMap((line, i) => (/\d\.\d{4,}|home-c-[-\d]/.test(line) ? [i + 1] : []));
    expect(found, 'README line numbers that look like a coordinate').toEqual([]);
  });
});

describe('README, Google setup section', () => {
  const HEADING = '## Google setup: keys and travel data';
  const start = readme.indexOf(`\n${HEADING}\n`);
  const next = start === -1 ? -1 : readme.indexOf('\n## ', start + 1);
  const section = start === -1 ? '' : readme.slice(start, next === -1 ? undefined : next);
  /** Position of `text` in the section; fails with the text when it is missing. */
  const at = (text: string) => {
    const index = section.indexOf(text);
    expect(index, `"${text}" in the Google setup section`).toBeGreaterThanOrEqual(0);
    return index;
  };

  it('exists, after the run and demo instructions, and says a fresh clone does not need it', () => {
    expect(start).toBeGreaterThan(0);
    const before = readme.slice(0, start);
    for (const heading of ['## Setup and run', '## State file and reset', '## 2-minute demo']) expect(before).toContain(heading);
    expect(before).toContain('```demo-request'); // read by tests/api/v2-readme-demo.test.ts
    expect(section.slice(0, at('[!WARNING]'))).toMatch(/already committed, so a fresh clone needs none of it/);
    // The two links to this section point at this heading.
    expect(before).toContain('(#google-setup-keys-and-travel-data)');
    expect(HEADING.slice(3).toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-')).toBe('google-setup-keys-and-travel-data');
  });

  it('gives the five steps in order: APIs, keys, .env, dry run then fetch, commit and restart', () => {
    const order = [
      at('### 1. Enable three APIs'),
      at('### 2. Create two keys'),
      at('### 3. Put the keys in `.env`'),
      at('### 4. Fetch the travel data'),
      at('npm run fetch:routes -- --dry-run'),
      at('\nnpm run fetch:routes  '), // the paid run, on its own line after the dry run
      at('### 5. Commit the cache and restart the server'),
      at('### What you see'),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('names the three APIs and no other Google API', () => {
    for (const api of ['Routes API', 'Geocoding API', 'Maps JavaScript API']) at(api);
    const named = new Set(section.match(/\b[A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)* API\b/g));
    expect([...named].sort()).toEqual(['Geocoding API', 'Maps JavaScript API', 'Routes API']);
  });

  it('gives each key its API restriction and its application restriction for local use', () => {
    const row = (label: string) => section.split('\n').find((line) => line.startsWith(`| ${label} |`)) ?? '';
    const server = row('Server key');
    expect(server).toContain('Routes API');
    expect(server).toContain('Geocoding API');
    expect(server).not.toContain('Maps JavaScript API');
    expect(server).toMatch(/\*\*None\*\*/);
    expect(server).toMatch(/referrer/);
    const browser = row('Browser key');
    expect(browser).toContain('Maps JavaScript API');
    expect(browser).not.toContain('Routes API');
    expect(browser).toContain('http://localhost:5173/*');
  });

  it('names both .env variables, with placeholders only', () => {
    expect(SERVER_KEY_NAME).toBe('GOOGLE_MAPS_SERVER_KEY'); // the name the fetch command reads
    for (const name of [SERVER_KEY_NAME, BROWSER_KEY_NAME]) {
      expect(readme).toContain(name);
      const assigned = [...section.matchAll(new RegExp(`^${name}=(.*)$`, 'gm'))].map((m) => m[1]);
      expect(assigned.length, `${name}= line`).toBeGreaterThan(0);
      for (const value of assigned) expect(value, `${name} value`).toMatch(/^<[a-z ]+>$/);
    }
    at('at the repo root');
    // The browser variable is the one the client reads.
    const mapModel = fs.readFileSync(path.join(root, 'client/src/components/map/mapModel.ts'), 'utf8');
    expect(mapModel).toContain(BROWSER_KEY_NAME);
  });

  it('shows only fetch flags the command accepts', () => {
    // Every `--flag` in the section, so a flag that is not on main cannot be documented.
    const flags = new Set(section.match(/(?<![\w-])--[a-z][a-z-]*/g));
    expect([...flags]).toContain('--dry-run');
    for (const flag of flags) {
      const accepted = parseArgs([flag]).ok || parseArgs([flag, 'value']).ok;
      expect(accepted, `${flag} is not a flag of npm run fetch:routes`).toBe(true);
    }
  });

  it('explains the exit codes and the two last lines the command prints', () => {
    expect([EXIT_OK, EXIT_INCOMPLETE, EXIT_USAGE]).toEqual([0, 1, 2]);
    for (const code of [EXIT_OK, EXIT_INCOMPLETE, EXIT_USAGE]) expect(section).toMatch(new RegExp(`^\\| \`${code}\` \\|`, 'm'));
    at(RESUME_LINE);
    at(CHECK_LINE);
    at('saved after every step');
    at('resumes');
  });

  // #637: the two other last lines of a run that exits 1, as server/geo/fetchScript.ts prints them.
  it('lists the --check-key hint and the --refetch command among the last lines, each in a row of its own', () => {
    const rows = section.split('\n').filter((line) => line.startsWith('| '));
    const rowWith = (text: string) => rows.filter((line) => line.split(' | ')[0].includes(text));
    // After Google refused the first call to an API.
    expect(CHECK_KEY_LINE).toContain('npm run fetch:routes -- --check-key');
    expect(rowWith(`"${CHECK_KEY_LINE}"`)).toHaveLength(1);
    expect(rowWith(`"${CHECK_KEY_LINE}"`)[0]).toMatch(/refused the first request/);
    // After a home moved: the command the run prints, with a placeholder where it prints the IDs.
    const command = refetchCommand(['PLACE']).replace('PLACE', '<placeId>');
    expect(command).toBe('npm run fetch:routes -- --refetch <placeId>');
    expect(rowWith(`\`${command}\``)).toHaveLength(1);
    expect(rowWith(`\`${command}\``)[0]).toMatch(/Moved homes:/);
    // The two that were there before are rows of the same table.
    for (const line of [RESUME_LINE, CHECK_LINE]) expect(rowWith(`"${line}"`), line).toHaveLength(1);
    expect(at('The last line of a run that exits 1')).toBeGreaterThan(at('**Exit codes**'));
  });

  it('offers --check-key between the dry run and the paid run, with the last lines of the check', () => {
    const step4 = section.slice(at('### 4. Fetch the travel data'), at('### 5. Commit the cache and restart the server'));
    const order = [
      step4.indexOf('\nnpm run fetch:routes -- --dry-run'),
      step4.indexOf('\nnpm run fetch:routes -- --check-key'),
      step4.indexOf('\nnpm run fetch:routes  '),
    ];
    expect(order.every((index) => index >= 0), 'three command lines in step 4').toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    const check = step4.split('\n').find((line) => line.startsWith('**Then check the key**')) ?? '';
    expect(check).toContain('`npm run fetch:routes -- --check-key`');
    expect(check).toMatch(/before the paid run/);
    expect(check).toMatch(/three small calls/); // billable, so it is said
    expect(check).toMatch(/writes nothing/);
    // The two endings of the check, as server/geo/keyCheck.ts prints them.
    const row = { api: 'geocoding', problem: 'unknown', detail: '', remedy: '' } as const;
    const ok = formatKeyCheck([{ ...row, ok: true }]).at(-1)!;
    const failed = formatKeyCheck([{ ...row, ok: false }]).at(-1)!;
    expect(ok).not.toBe(failed);
    expect(check).toContain(`"${ok}"`);
    expect(check).toContain(`"${failed}"`);
  });

  it('runs --drop-entered before git add, and says why', () => {
    const step5 = section.slice(at('### 5. Commit the cache and restart the server'), at('### What you see'));
    expect(DROP_ENTERED_COMMAND).toBe('npm run fetch:routes -- --drop-entered');
    const drop = step5.indexOf(`\n${DROP_ENTERED_COMMAND}`);
    const add = step5.indexOf('\ngit add fixtures/nyc/');
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(add).toBeGreaterThan(drop);
    const why = step5.split('\n').find((line) => line.startsWith('**Why the drop comes first:**')) ?? '';
    expect(why).toMatch(/typed address/);
    expect(why).toContain('`home-c-<lat>_<lng>`'); // the placeholder, never a coordinate
    expect(why).toMatch(/must never be committed/);
    expect(why).toMatch(/never an ID/);
    expect(why).toMatch(/server has to be stopped/);
    // The old claim is gone: the files do hold coordinates, of businesses and made-up homes only after the drop.
    expect(step5).not.toMatch(/The two files hold coordinates, seconds/);
    expect(step5).toMatch(/After the drop the two files hold/);
    // The page that creates such a home points at this step.
    expect(section.slice(at('### What you see'))).toMatch(/remove it before you commit the cache \(step 5\)/);
  });

  it('takes the request numbers from the dry run, not from typed numbers', () => {
    at('Google requests:');
    // No count of requests, pairs, route lines, businesses or homes is typed into the section.
    expect(section).not.toMatch(/\d(?:[\d,]*\d)?[ \t]+(?:Google\s+)?(?:requests?|pairs?|route lines?|polylines?|businesses|homes)\b/i);
    expect(section).not.toMatch(/Google requests:\s*\d/);
  });

  it('says what to commit and that the server is restarted', () => {
    const step5 = section.slice(at('### 5. Commit the cache and restart the server'), at('### What you see'));
    expect(step5).toContain('fixtures/nyc/matrix.json');
    expect(step5).toContain('fixtures/nyc/polylines.json');
    expect(step5).toMatch(/restart the server/i);
    expect(step5).not.toMatch(/git add[^\n]*(\.env|-A|\s\.(\s|$))/); // never a command that could stage .env
  });

  it('describes what you see on the main paths: the map, the missing key, the missing cache', () => {
    const seen = section.slice(at('### What you see'));
    for (const p of MAIN_PATHS) expect(seen, p).toContain(`\`${p}\``);
    // The sentences are the ones the pages show.
    const mapModel = fs.readFileSync(path.join(root, 'client/src/components/map/mapModel.ts'), 'utf8');
    for (const name of ['KEY_MISSING_TEXT', 'AUTH_ERROR_TEXT']) {
      const text = new RegExp(`${name} = '([^']+)'`).exec(mapModel)?.[1];
      expect(text, name).toBeTruthy();
      expect(seen).toContain(`"${text}"`);
    }
    expect(seen).toContain(`"${ADDRESS_SEARCH_NEEDS_KEY_TEXT}"`);
    expect(seen).toContain('/api/v2');
    expect(seen).toContain('503');
    expect(seen).toContain('`travel_data_missing`');
    expect(seen).toContain(TRAVEL_DATA_MISSING_TEXT);
    // The old preview paths are a redirect, and the state file is described once, in its own section.
    expect(seen.split('\n').find((line) => line.includes('`/nyc/')) ?? '').toMatch(/redirect to the main paths/);
    expect(seen).not.toMatch(/\/nyc\/(simulator|employee|business|help)/);
    expect(seen).toContain('`data/state-v2.json`');
    expect(seen).toContain('(#state-file-and-reset)');
    // The example employee is one of the story's.
    const story = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/nyc/demoStory.json'), 'utf8')) as {
      featuredEmployees: { id: string }[];
    };
    const example = /\/employee\/(emp-\d+)/.exec(seen)?.[1];
    expect(story.featuredEmployees.map((employee) => employee.id)).toContain(example);
  });

  it('has the warning box: no key committed, pasted or printed; .env is gitignored; the fetch is billed', () => {
    const box = section
      .split('\n')
      .filter((line) => line.startsWith('>'))
      .join('\n');
    expect(box).toContain('[!WARNING]');
    expect(box).toMatch(/Never commit, paste or print a key/);
    expect(box).toMatch(/`\.env` is gitignored/);
    expect(box).toMatch(/billed/);
    expect(at('[!WARNING]')).toBeLessThan(at('### 1. Enable three APIs'));
    const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/);
    expect(gitignore).toContain('.env');
  });
});
