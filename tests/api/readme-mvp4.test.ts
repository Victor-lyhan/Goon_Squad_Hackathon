// #800: the README's two MVP IV sections (docs/mvp4.md F1 and F3), read against the code and the committed
// study page. Names, defaults, the fallback line and the headline numbers are taken from where they are
// defined, so a README that quotes an old value fails here. No key, no network, nothing written.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  NETWORK_FINISHED_TEXT, NETWORK_PLAYING_TEXT, PAUSED_TEXT, PLAY_IDLE, playButtonView, stepAnnouncement,
} from '../../client/src/components/sim/v2/compose/journeyPlay';
import { FINISHED_REASON } from '../../client/src/components/sim/v2/controls/controlsModel';
import { DEFAULT_GRID, gridRuns } from '../../scripts/study/grid';
import { DEFAULT_STUDY_CSV, DEFAULT_STUDY_OUT, DEFAULT_STUDY_PAGE } from '../../scripts/study/cli';
import { DEFAULT_GEMINI_MODEL, GEMINI_KEY_NAME, GEMINI_MODEL_NAME, geminiKey } from '../../server/ai/env';
import { DEFAULT_GEMINI_TIMEOUT_MS, GeminiUnavailable } from '../../server/ai/gemini';
import { INVALID_ANSWER_MESSAGE } from '../../server/ai/geminiParser';
import { fallbackLogLine, geminiLogLine, NO_KEY_LOG_LINE } from '../../server/api/v2/parseRequestRoutes';
import { ParseRequestBody } from '../../shared/v2/parseRequest';

const root = path.resolve(__dirname, '../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const readme = read('README.md');

/** A `## ` section of the README, heading included, up to the next `## ` heading. */
function sectionOf(heading: string): string {
  const start = readme.indexOf(`\n${heading}\n`);
  if (start === -1) return '';
  const next = readme.indexOf('\n## ', start + 1);
  return readme.slice(start, next === -1 ? undefined : next);
}
/** GitHub's anchor of a heading. */
const anchorOf = (heading: string) => heading.replace(/^#+ /, '').toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-');
/** The cells of the table row whose first cell is `first`, or [] when there is no such row. */
const rowOf = (section: string, first: string) =>
  (section.split('\n').find((line) => line.startsWith(`| ${first} |`)) ?? '').split('|').slice(1, -1).map((cell) => cell.trim());

describe('README: Requests in plain English (Gemini)', () => {
  const HEADING = '## Requests in plain English (Gemini)';
  const section = sectionOf(HEADING);

  it('exists, and the links to it point at its heading', () => {
    expect(section).not.toBe('');
    expect(anchorOf(HEADING)).toBe('requests-in-plain-english-gemini');
    expect(readme.split(`(#${anchorOf(HEADING)})`).length - 1).toBeGreaterThanOrEqual(2);
    expect(section).toContain('`POST /api/v2/parse-request`');
    expect(section).toMatch(/\*\*No key is needed\.\*\*/);
  });

  it('names the two .env variables and the default model as server/ai/env.ts has them, with placeholders only', () => {
    expect([GEMINI_KEY_NAME, GEMINI_MODEL_NAME]).toEqual(['GEMINI_API_KEY', 'GEMINI_MODEL']);
    for (const name of [GEMINI_KEY_NAME, GEMINI_MODEL_NAME, DEFAULT_GEMINI_MODEL, '.env']) expect(section).toContain(`\`${name}\``);
    expect(section).toMatch(new RegExp(`^${GEMINI_KEY_NAME}=<[a-zA-Z ]+>$`, 'm')); // the line for .env
    expect(section).toMatch(/`GEMINI_MODEL`\*\* is optional/);
    // No value is ever written after either name, anywhere in the file.
    for (const name of [GEMINI_KEY_NAME, GEMINI_MODEL_NAME]) {
      const values = [...readme.matchAll(new RegExp(`${name}=(<[^>\n]*>|[^\\s\`]*)`, 'g'))].map((m) => m[1]);
      expect(values.length, `${name}= in the README`).toBeGreaterThan(0);
      for (const value of values) expect(value, `${name} value`).toMatch(/^<[a-zA-Z ]+>$/);
    }
  });

  it('says server only, never a VITE_ variable, and that the key travels in the x-goog-api-key header', () => {
    expect(section).toMatch(/Server only, never a `VITE_` variable/);
    expect(readme).not.toMatch(/VITE_\w*GEMINI/i);
    expect(section).toContain('`x-goog-api-key`');
    expect(section).toMatch(/never in a URL/);
    expect(read('server/ai/gemini.ts')).toContain("'x-goog-api-key': apiKey");
    expect(section).toMatch(/never commit, paste or print it/);
  });

  it('says a key that starts with AQ is fine, which is what the server does', () => {
    expect(section).toMatch(/A key that starts with `AQ` is fine/);
    expect(geminiKey({ [GEMINI_KEY_NAME]: 'AQ.placeholder' })).toBe('AQ.placeholder'); // no prefix check
  });

  it('says to restart the server after editing .env', () => {
    expect(section).toMatch(/\*\*Restart the server after editing `\.env`\*\*/);
  });

  it('gives the three cases with their source and label, and the time limit of the call', () => {
    const seconds = `${DEFAULT_GEMINI_TIMEOUT_MS / 1000} s`;
    expect(seconds).toBe('6 s'); // docs/mvp4.md F1
    const rows = section.split('\n').filter((line) => line.startsWith('| ') && line.includes('"Parsed '));
    expect(rows).toHaveLength(3);
    const [noKey, answered, failed] = rows;
    expect(noKey).toMatch(/^\| No `GEMINI_API_KEY` \|.*\| `offline` \| "Parsed offline" \|$/);
    expect(answered).toMatch(/\| `gemini` \| "Parsed by Gemini" \|$/);
    expect(answered).toContain(`within ${seconds}`);
    expect(failed).toMatch(/\| `offline` \| "Parsed offline" \|$/);
    expect(failed).toMatch(/an error/);
    expect(failed).toContain(`within ${seconds}`);
  });

  it('quotes the fallback line as the server prints it, and the causes in the words of server/ai/gemini.ts', () => {
    const line = fallbackLogLine(new GeminiUnavailable('http', { status: 403 }).message);
    expect(line).toBe('[parse-request] Gemini is unavailable: HTTP 403. Parsed offline.');
    expect(section).toContain(`\n${line}\n`);
    const cause = (error: GeminiUnavailable) => /^Gemini is unavailable: (.+)\.$/.exec(error.message)?.[1] ?? 'no cause';
    for (const error of [
      new GeminiUnavailable('http', { status: 404 }),
      new GeminiUnavailable('http', { status: 429 }),
      new GeminiUnavailable('timeout', { timeoutMs: DEFAULT_GEMINI_TIMEOUT_MS }),
      new GeminiUnavailable('network'),
    ]) {
      expect(rowOf(section, `\`${cause(error)}\``), cause(error)).toHaveLength(3);
    }
    expect(section).toContain(`"${fallbackLogLine(INVALID_ANSWER_MESSAGE)}"`);
    expect(section).toMatch(/never holds the key, the sentence or Gemini's answer/);
    // The two lines of the requests that did not fall back (#811), as the server prints them.
    expect(section).toContain(`\n${geminiLogLine(DEFAULT_GEMINI_MODEL, 1840)}\n`);
    expect(section).toContain(`\n${NO_KEY_LOG_LINE}\n`);
  });

  it('the curl example sends a body the route accepts, and names both values of source', () => {
    expect(section).toContain('curl -s -X POST http://localhost:3001/api/v2/parse-request');
    const body = /-d '(\{[^']+\})'/.exec(section)?.[1] ?? '';
    const parsed = ParseRequestBody.safeParse(JSON.parse(body));
    expect(parsed.success).toBe(true);
    // The sentence is the example of docs/mvp4.md.
    expect(read('docs/mvp4.md')).toContain(parsed.success ? parsed.data.text : 'no sentence');
    for (const source of ['gemini', 'offline']) expect(section).toContain(`\`"source":"${source}"\``);
  });
});

// #850: the README after the MVP IV UI batch (#831 Play bar on the map, #832 one-line panels with Details,
// #842 the two-line step line). Each quoted line is built by the page's own code or read from its source,
// so a reworded page fails here.
describe('README: the simulator Play bar and panels after the UI batch', () => {
  const state = sectionOf('## State file and reset');
  const watch = sectionOf('## 30-second demo');
  const demo = sectionOf('## 2-minute demo');
  /** A journey as far as the step line reads it: four steps, the first `done` of them done. */
  const journey = (done: number, recipient: string) => ({
    steps: [['Pickup at sender', 'Blue Bottle Coffee'], ['Drop at relay point', 'Etsy'], ['Pickup at relay point', 'Etsy'], ['Delivered to recipient', recipient]]
      .map(([label, placeName], i) => ({ n: i + 1, label, placeName, legIndex: i < 2 ? 0 : 1, state: i < done ? 'done' : i === done ? 'current' : 'upcoming' })),
    carriers: [], commutes: [], endOfCommute: null,
  }) as never;

  it('says where Play, Pause and Back to start are: one bar at the bottom center of the map', () => {
    // The bar is centred on the map's bottom edge by the page's CSS (#831), in the map, not in a panel.
    const bar = /\.spc-playbar \{[^}]*\}/.exec(read('client/src/components/sim/v2/compose/compose.css'))?.[0] ?? '';
    for (const rule of ['position: absolute', 'left: 50%', 'bottom: 32px', 'transform: translateX(-50%)']) expect(bar).toContain(rule);
    expect(read('client/src/components/sim/v2/compose/SimPageBody.tsx')).toMatch(/<div className="spc-map">\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<div className="spc-playbar"/);
    const play = state.split('\n').find((line) => line.startsWith('In the Simulator, **Play** with no package picked')) ?? '';
    expect(play).toMatch(/\*\*Play\*\* and \*\*Back to start\*\* sit in one small bar at the bottom center of the map, the Play bar/);
    expect(watch).toMatch(/The controls are in the Play bar, a small bar at the bottom center of the map\./);
    expect(demo.split('\n').find((line) => line.startsWith('5. **Simulator**')) ?? '').toMatch(/The controls are at the bottom center of the map:/);
  });

  it('quotes the Play bar lines of network Play as the page prints them', () => {
    const play = state.split('\n').find((line) => line.startsWith('In the Simulator, **Play** with no package picked')) ?? '';
    for (const text of [NETWORK_PLAYING_TEXT, FINISHED_REASON, NETWORK_FINISHED_TEXT]) expect(play, text).toContain(`"${text}"`);
    expect(play.indexOf(`"${NETWORK_PLAYING_TEXT}"`)).toBeLessThan(play.indexOf(`"${FINISHED_REASON}"`));
    // At the end of the run the button has nothing left to play: it is disabled, with FINISHED_REASON as its note.
    const atEnd = playButtonView({ packagePicked: false, journey: null, play: PLAY_IDLE, clock: { playing: false, timeMin: 2160 }, busy: false, simEndMin: 2160 });
    expect(atEnd).toEqual({ label: 'Play', action: null, note: FINISHED_REASON });
    expect(play).toMatch(/\*\*Play\*\* is greyed out/);
  });

  it('quotes the step line of a journey: a step, paused, and the end, for both demos', () => {
    expect(stepAnnouncement(journey(1, 'Brooklyn Roasting Company'))).toBe('Step 2 of 4 next: Drop at relay point at Etsy.');
    expect(watch).toContain('"Step 2 of 4 next: Drop at relay point at Etsy."');
    expect(watch).toContain(`"${PAUSED_TEXT}"`);
    expect(watch).toContain(`step line reads "${stepAnnouncement(journey(4, 'Brooklyn Roasting Company'))}"`);
    // The 2-minute demo's journey ends at the recipient of its request block.
    const recipient = /^recipient: (.+)$/m.exec(demo)?.[1] ?? 'no recipient in the block';
    const end = stepAnnouncement(journey(4, recipient));
    expect(end).toBe(`Journey complete: Delivered to recipient at ${recipient}.`);
    expect(demo.split('\n').find((line) => line.startsWith('5. **Simulator**')) ?? '').toContain(`the line under the buttons then reads "${end}"`);
    // #852 (PR #859) removed the visible step line (`.ctl-line`) from the Play bar, so its markup is no longer
    // asserted here. The README sentences about that line are left for the README follow-up (STATUS, pass 99).
    expect(watch).toMatch(/never takes more than two lines/);
    // The sentence from before #831, when the buttons were in the left panel, is gone.
    expect(readme).not.toContain(`The line under the buttons then reads "${FINISHED_REASON}"`);
  });

  it('names the right panel and its Details button as the page does, with the four step labels', () => {
    expect(read('client/src/components/sim/v2/SimWorkspace.tsx')).toContain('<Panel side="right" title="Inspector"');
    expect(read('client/src/components/sim/v2/Details.tsx')).toContain("DETAILS_LABEL = 'Details'");
    const panel = watch.split('\n').find((line) => line.includes('The **Inspector** panel on the right')) ?? '';
    const model = read('client/src/components/sim/v2/journey/journeyModel.ts');
    const labels = ['Pickup at sender', 'Drop at relay point', 'Pickup at relay point', 'Delivered to recipient'];
    for (const label of labels) {
      expect(model).toContain(`'${label}'`);
      expect(panel).toContain(`"${label}"`);
    }
    expect(labels.map((label) => panel.indexOf(`"${label}"`))).toEqual(labels.map((label) => panel.indexOf(`"${label}"`)).sort((a, b) => a - b));
    // #832: the carriers' minutes and reward are under the timeline's Details toggle, closed at first.
    expect(panel).toMatch(/\*\*Details\*\*, the button just above the first step, adds each carrier's home neighborhood, extra minutes and reward/);
    const timeline = read('client/src/components/sim/v2/journey/JourneyTimeline.tsx');
    expect(timeline).toMatch(/<ul id=\{legsId\} className="jt__legs" aria-label="Carriers" data-details-body="" hidden=\{!detailsOpen\}>/);
    expect(timeline).toContain('const [detailsOpen, setDetailsOpen] = useState(false);');
    expect(watch).not.toMatch(/both carriers with their extra minutes and reward/);
  });
});

describe('README: The numbers: Relay vs traditional delivery', () => {
  const HEADING = '## The numbers: Relay vs traditional delivery';
  const section = sectionOf(HEADING);
  const committed = fs.readFileSync(DEFAULT_STUDY_PAGE, 'utf8');
  /** The page as text, with the README's straight apostrophe. */
  const pageText = committed.replace(/<style>[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/’/g, "'");
  /** The headline tiles of the committed page: label, value, detail. */
  const tiles = [...committed.matchAll(
    /<div class="tile"><p class="tile-label">([^<]+)<\/p><p class="tile-value">([^<]+)<\/p><p class="tile-detail">([^<]+)<\/p><\/div>/g,
  )].map((m) => m.slice(1, 4).map((cell) => cell.replace(/’/g, "'")));

  it('exists, and the link to it points at its heading', () => {
    expect(section).not.toBe('');
    expect(anchorOf(HEADING)).toBe('the-numbers-relay-vs-traditional-delivery');
    expect(readme).toContain(`(#${anchorOf(HEADING)})`);
    expect(sectionOf('## Setup and run')).toMatch(/^\| `\/study\.html` \|/m);
  });

  it('names the command, the three files it writes and the path of the page', () => {
    const rel = (file: string) => path.relative(root, file).split(path.sep).join('/');
    expect(rel(DEFAULT_STUDY_OUT)).toBe('data/study/results.json');
    expect(rel(DEFAULT_STUDY_PAGE)).toBe('client/public/study.html');
    expect(rel(DEFAULT_STUDY_CSV)).toBe('client/public/study/runs.csv');
    for (const text of ['npm run study', '`data/study/results.json`', '`client/public/study.html`', '`client/public/study/runs.csv`', '`/study.html`']) {
      expect(section).toContain(text);
    }
    // #841: the CSV is committed, the page links to it under the name the README gives, and the worker flag is named.
    expect(fs.existsSync(DEFAULT_STUDY_CSV)).toBe(true);
    expect(pageText).toContain('Download every run (CSV)');
    expect(section).toContain('**Download every run (CSV)**');
    expect(section).toContain('`npm run study -- --workers 4`');
    expect(section).toContain('`npm run study -- --check`');
    // Vite serves client/public at the root, and the results file is not committed.
    expect(read('vite.config.ts')).toContain("root: 'client'");
    expect(read('.gitignore').split(/\r?\n/)).toContain('/data/');
    expect(section).toMatch(/`data\/study\/results\.json`: .*\(gitignored\)/);
  });

  it('names the baseline as the page does: a standard next-day B2B courier, not a same-hour one', () => {
    expect(section).toMatch(/\*\*The baseline is a standard next-day B2B courier, not a same-hour one\*\*/);
    expect(pageText).toContain('standard next-day B2B courier');
    expect(pageText).toContain('not a same-hour courier');
  });

  it('quotes the headline numbers of the committed page', () => {
    expect(tiles.map(([label]) => label)).toEqual([
      'Cost to the sender', 'Added vehicle miles', 'CO₂', "Delivered by the courier's promised time", 'Match rate',
    ]);
    for (const [label, value, detail] of tiles) {
      // Fails after a study run that moved a number: copy the new value from client/public/study.html.
      expect(rowOf(section, label), `the README row of "${label}"`).toEqual([label, value, detail]);
    }
    // The page's headline: "3,024 simulations".
    const runs = /<h1>([\d,]+) simulations<\/h1>/.exec(committed)?.[1];
    expect(runs).toBeTruthy();
    expect(section).toContain(`averages over ${runs} simulated runs`);
    expect(section).toContain(`runs the ${runs} simulations`);
    const matchRate = tiles[4][1];
    expect(section).toContain(`${matchRate} of the requested packages`);
    // How often Relay is ahead: cost, miles, CO2, in the page's order.
    const ahead = [...pageText.matchAll(/Relay ahead in ([\d,]+ of [\d,]+ runs)/g)].map((m) => m[1]);
    expect(ahead).toHaveLength(3);
    expect(ahead[1]).toBe(ahead[2]);
    expect(section).toContain(`on cost in ${ahead[0]}, and on miles and CO₂ in ${ahead[1]}`);
    // The line under the match-rate chart, quoted with its two figures.
    const rises = /The match rate rises as more employees join: [\d.]+% with \d+ employees, [\d.]+% with \d+\./.exec(pageText)?.[0];
    expect(rises).toBeTruthy();
    expect(section).toContain(rises);
  });

  it('describes the grid of scripts/study/grid.ts', () => {
    const list = (values: readonly number[]) => `${values.slice(0, -1).join(', ')} and ${values.at(-1)}`;
    const { seeds, employeeCounts, packageCounts, detourLimitsMin } = DEFAULT_GRID;
    expect(section).toContain(
      `every combination of ${seeds.length} seeds, of ${list(employeeCounts)} commuting employees, `
      + `of ${list(packageCounts)} packages, and of detour limits of ${list(detourLimitsMin)} minutes`,
    );
    const planned = String(gridRuns(DEFAULT_GRID).length).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    expect(committed).toContain(`<h1>${planned} simulations</h1>`);
    expect(section).toContain(`averages over ${planned} simulated runs`);
  });

  it('says "100% on time" holds by construction, with the times the page gives, and that the cost is the match rate', () => {
    const bullet = section.split('\n').find((line) => line.startsWith('- **"100% on time" holds by construction.')) ?? '';
    expect(bullet).not.toBe('');
    expect(tiles[3][1]).toBe('100.0%');
    expect(tiles[3][2]).toMatch(/, 0\.0% late$/);
    // The same two times as the page's "Why nothing is late here", in the README's way of writing a time.
    for (const time of ['Day 2, 10:00', 'Day 2, 10:30']) {
      expect(pageText).toContain(`${time} a.m.`);
      expect(bullet).toContain(`${time} AM`);
    }
    expect(bullet).toMatch(/Relay only accepts a package it can deliver by its deadline/);
    expect(bullet).toMatch(/shows in the match rate, not in lateness/);
    expect(section).toMatch(/assumed to always keep that promise/);
  });

  it('says every assumption is on the page with its value and reason, and when to run the study again', () => {
    expect(section).toMatch(/\*\*Every assumption is listed on the page with its value and the reason for it\*\*/);
    for (const file of ['scripts/study/assumptions.ts', 'server/domain/v2/', 'scripts/study/', 'fixtures/nyc/']) {
      expect(section).toContain(`\`${file}\``);
      expect(fs.existsSync(path.join(root, file)), file).toBe(true);
    }
    expect(section).toMatch(/After a change to the travel cache .* run it again and commit `client\/public\/study\.html` and `client\/public\/study\/runs\.csv`\./);
  });
});
