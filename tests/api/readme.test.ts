import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TRAVEL_DATA_MISSING_TEXT } from '../../client/src/components/employee/v2/live/employeeWorkspaceState';
import { PREVIEW_SIMULATOR_PATH, previewEmployeePath } from '../../client/src/ui/shellModel';
import { SERVER_KEY_NAME } from '../../server/geo/env';
import { CHECK_LINE, EXIT_INCOMPLETE, EXIT_OK, EXIT_USAGE, RESUME_LINE, parseArgs } from '../../server/geo/fetchScript';

const root = path.resolve(__dirname, '../..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

describe('README', () => {
  it('only references npm scripts that exist', () => {
    const used = [...readme.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) expect(Object.keys(pkg.scripts), `npm run ${name}`).toContain(name);
    // The MVP II fetch command is one of them, so a rename in package.json fails here.
    expect(used).toContain('fetch:routes');
    expect(Object.keys(pkg.scripts)).toContain('fetch:routes');
  });

  it('documents the setup scripts', () => {
    for (const s of ['dev', 'build']) expect(readme).toContain(`npm run ${s}`);
  });

  it('mentions the state file and ports', () => {
    expect(readme).toContain('data/state.json');
    expect(readme).toContain('3001');
    expect(readme).toContain('5173');
  });

  it('holds nothing that looks like a real Google key', () => {
    const lines = readme.split(/\r?\n/);
    const leaks = lines.flatMap((line, i) => (/AIza[0-9A-Za-z_-]{30,}/.test(line) ? [i + 1] : []));
    expect(leaks, 'README line numbers that look like a key').toEqual([]);
  });
});

describe('README, MVP II section', () => {
  const HEADING = '## MVP II: real NYC data';
  const start = readme.indexOf(`\n${HEADING}\n`);
  const next = start === -1 ? -1 : readme.indexOf('\n## ', start + 1);
  const section = start === -1 ? '' : readme.slice(start, next === -1 ? undefined : next);
  /** Position of `text` in the section; fails with the text when it is missing. */
  const at = (text: string) => {
    const index = section.indexOf(text);
    expect(index, `"${text}" in the MVP II section`).toBeGreaterThanOrEqual(0);
    return index;
  };

  it('exists and leaves the MVP 1 instructions in place', () => {
    expect(start).toBeGreaterThan(0);
    const before = readme.slice(0, start);
    for (const heading of ['## Setup and run', '## State file and reset', '## 2-minute demo']) expect(before).toContain(heading);
    expect(before).toContain('```demo-request'); // read by tests/api/demo-script.test.ts
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
    for (const name of [SERVER_KEY_NAME, 'VITE_GOOGLE_MAPS_BROWSER_KEY']) {
      expect(readme).toContain(name);
      const assigned = [...section.matchAll(new RegExp(`^${name}=(.*)$`, 'gm'))].map((m) => m[1]);
      expect(assigned.length, `${name}= line`).toBeGreaterThan(0);
      for (const value of assigned) expect(value, `${name} value`).toMatch(/^<[a-z ]+>$/);
    }
    at('at the repo root');
    // The browser variable is the one the client reads.
    const mapModel = fs.readFileSync(path.join(root, 'client/src/components/map/mapModel.ts'), 'utf8');
    expect(mapModel).toContain('VITE_GOOGLE_MAPS_BROWSER_KEY');
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

  it('describes what you see: preview pages, the 503 text and the v2 state file', () => {
    const seen = section.slice(at('### What you see'));
    expect(seen).toContain(PREVIEW_SIMULATOR_PATH);
    expect(seen).toContain(previewEmployeePath('<id>').replace('%3C', '<').replace('%3E', '>'));
    expect(seen).toMatch(/Business page follows/);
    expect(seen).toContain('/api/v2');
    expect(seen).toContain('503');
    expect(seen).toContain(TRAVEL_DATA_MISSING_TEXT); // the sentence the NYC pages show
    expect(seen).toContain('data/state-v2.json');
    expect(seen).toMatch(/[Dd]elete `data\/state-v2\.json`/);
    // The example employee is one of the story's.
    const story = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/nyc/demoStory.json'), 'utf8')) as {
      featuredEmployees: { id: string }[];
    };
    const example = /\/nyc\/employee\/(emp-\d+)/.exec(seen)?.[1];
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
