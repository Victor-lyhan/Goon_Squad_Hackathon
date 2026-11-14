import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { UNAVAILABLE_TEXT as ADDRESS_SEARCH_NEEDS_KEY_TEXT } from '../../client/src/components/employee/v2/addressSearchModel';
import { TRAVEL_DATA_MISSING_TEXT } from '../../client/src/components/employee/v2/live/employeeWorkspaceState';
import { ENV_INDICATOR_TEXT } from '../../client/src/ui/shellModel';
import { DEFAULT_V2_STATE_PATH, sourcePathFor } from '../../server/api/v2/bootRun';
import { SERVER_KEY_NAME } from '../../server/geo/env';
import { CHECK_LINE, EXIT_INCOMPLETE, EXIT_OK, EXIT_USAGE, RESUME_LINE, parseArgs } from '../../server/geo/fetchScript';

const root = path.resolve(__dirname, '../..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
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
const MAIN_PATHS = ['/', '/business/<id>', '/employee/<id>', '/simulator', '/help'];

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
    expect(ENV_INDICATOR_TEXT).toBe('Real NYC locations · simulated deliveries'); // the header says the same
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
    // The in-app reset, in the words of the simulator's left panel.
    expect(state).toContain('**Start new planning cycle**');
    expect(read('client/src/components/sim/v2/controls/PlanningControls.tsx')).toContain('Start new planning cycle');
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
      ['`mvp2-ui-redesign.md`', 'docs/mvp2-ui-redesign.md'], ['`SPEC.md`', 'SPEC.md'], ['`DECISIONS.md`', 'DECISIONS.md'],
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
