// #800: the README's two MVP IV sections (docs/mvp4.md F1 and F3), read against the code and the committed
// study page. Names, defaults, the fallback line and the headline numbers are taken from where they are
// defined, so a README that quotes an old value fails here. No key, no network, nothing written.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  NETWORK_FINISHED_TEXT, NETWORK_PLAYING_TEXT, PAUSED_TEXT, PLAY_IDLE, playButtonView, stepAnnouncement,
} from '../../client/src/components/sim/v2/compose/journeyPlay';
import { ADVICE_COPY, ADVICE_TAGS, MAX_OPTIONS, adviceCard } from '../../client/src/components/business/v2/adviceModel';
import { FINISHED_REASON } from '../../client/src/components/sim/v2/controls/controlsModel';
import { DEFAULT_GRID, gridRuns } from '../../scripts/study/grid';
import { DEFAULT_STUDY_CSV, DEFAULT_STUDY_OUT, DEFAULT_STUDY_PAGE } from '../../scripts/study/cli';
import { ADVISE_TIMEOUT_MS, MAX_OPTIONS as SERVER_MAX_OPTIONS, OFFLINE_EARLIER_MIN, tagWords } from '../../server/ai/advisor';
import { DEFAULT_GEMINI_MODEL, GEMINI_KEY_NAME, GEMINI_MODEL_NAME, geminiKey } from '../../server/ai/env';
import { DEFAULT_GEMINI_TIMEOUT_MS, GeminiUnavailable } from '../../server/ai/gemini';
import { INVALID_ANSWER_MESSAGE } from '../../server/ai/geminiParser';
import { fallbackLogLine, geminiLogLine, NO_KEY_LOG_LINE } from '../../server/api/v2/parseRequestRoutes';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import type { AdviseTag } from '../../shared/v2/api';
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

// #877: the advisor (#862 the route, #863 the Options card). The labels, the limits and the marks are read from
// the code; what the card shows for the demo sentence on the real run is proven in v2-advise-readme-demo.test.ts.
describe('README: Options for a request (the Options card and POST /api/v2/advise)', () => {
  const HEADING = '### Options for a request';
  const gemini = sectionOf('## Requests in plain English (Gemini)');
  const section = gemini.includes(`\n${HEADING}\n`) ? gemini.slice(gemini.indexOf(`\n${HEADING}\n`)) : '';
  const demo = sectionOf('## 2-minute demo');
  const step2 = demo.split('\n').find((line) => line.startsWith('2. **Business**')) ?? '';
  /** One row of the table of cases: the `source` cell says which. */
  const rows = section.split('\n').filter((line) => line.startsWith('| ') && /\| `(offline|gemini)` \|/.test(line));

  it('exists inside the Gemini section, and the links to it point at its heading', () => {
    expect(section).not.toBe('');
    expect(anchorOf(HEADING)).toBe('options-for-a-request');
    expect(readme.split(`(#${anchorOf(HEADING)})`).length - 1).toBeGreaterThanOrEqual(2);
    expect(section).toContain('`POST /api/v2/advise`');
    expect(read('server/api/v2/adviseRoutes.ts')).toContain("router.post('/advise'");
    expect(section).toMatch(/It only reads the run: it stores nothing and sends no delivery\./);
  });

  it('gives the three cases with their source, which the card no longer shows as a label (#960)', () => {
    expect(rows).toHaveLength(3);
    const [noKey, answered, failed] = rows;
    expect(noKey.startsWith('| No `GEMINI_API_KEY` |')).toBe(true);
    expect(noKey.endsWith('| `offline` |')).toBe(true);
    expect(answered.endsWith('| `gemini` |')).toBe(true);
    expect(failed.endsWith('| `offline` |')).toBe(true);
    // The card has no label for the source, so README names none: not in the table, not in the demo.
    expect(section).toContain('The card does not say who made the options; the `source` is only in the answer.');
    expect(readme).not.toMatch(/Priced by Relay|Planned by Gemini/);
    expect(Object.values<string>(ADVICE_COPY).filter((line) => /Gemini|AI model/.test(line))).toEqual([]);
    // #959: the engine picks the fastest and the cheapest; the third is Gemini's in one call within the advisor's
    // own limit, else the balanced plan.
    expect(section).toContain('the **fastest** (the earliest arrival; on a tie the lower price), the **cheapest** (the lowest price; on a tie the earlier arrival)');
    expect(noKey).toContain('the **balanced** plan');
    expect(answered).toContain(`Gemini answers within ${ADVISE_TIMEOUT_MS / 1000} s`);
    expect(answered).toContain('Gemini, in one call, recommends the plan that fits the request best');
    expect(failed).toContain(`does not answer within ${ADVISE_TIMEOUT_MS / 1000} s`);
    expect(failed).toContain('the balanced plan, as without a key');
    expect(read('server/ai/advisor.ts')).not.toMatch(/MAX_TOOL_CALLS|functionDeclarations/);   // no tool loop any more
    // The labels as the advisor writes them (`optionLabel`: the tags, the route, the price).
    for (const tags of [['fastest'], ['cheapest'], ['balanced']] as const) expect(section).toContain(`"${tagWords(tags)}: `);
    // The body: the draft, and the sentence for Gemini to read.
    expect(section).toContain('`{ "draft": <the draft, with sender, recipient and both times>, "text": <the sentence, optional> }`');
    expect(read('server/api/v2/adviseRoutes.ts')).toContain('text: optionalText,');
    // The what-ifs, tried only when the request as typed has no plan: ready earlier, deliver-by out to the window.
    expect(section).toContain(`ready ${OFFLINE_EARLIER_MIN / 60} hours earlier (never before the simulated time)`);
    expect(section).toContain(`deliver-by moved to ${DEFAULT_SETTINGS.flexWindowMin / 60} hours after ready when that is later`);
    expect(read('server/ai/advisor.ts')).toContain('Math.max(draft.deadlineMin, draft.readyMin + engine.flexWindowMin)');
  });

  it('names the marks and the button of the card as the page has them, and says up to three options', () => {
    expect([MAX_OPTIONS, SERVER_MAX_OPTIONS]).toEqual([3, 3]);
    expect(section).toContain(`the Business page shows an **${ADVICE_COPY.title}** card above the draft: up to three ways to send the request`);
    // #960: the badges, in the card's own words and order; a row's name leaves the words of its badges out.
    const badges = ADVICE_TAGS.map((tag) => `"${ADVICE_COPY[tag]}"`);
    expect(badges).toEqual(['"Fastest"', '"Cheapest"', '"Recommended"', '"Balanced"']);
    expect(section).toContain(`On the card each option shows its tags as badges, ${badges.slice(0, 2).join(', ')}, ${badges[2]} or ${badges[3]} (one plan can have two), so its name leaves those words out ("Relay via Etsy, $9.50").`);
    expect(section).toContain('Then come its price, its arrival time and its summary, or for a recommended option the reason.');
    expect(section).toContain('The rows are in the order Fastest, Cheapest, then Recommended or Balanced.');
    expect(section).toContain(`The option whose times the form holds is marked "${ADVICE_COPY.chosen}".`);
    expect(section).toContain(`**${ADVICE_COPY.choose}** puts that option's ready and deliver-by times in the form and sends nothing`);
    expect(section).toMatch(/If the call fails or finds no option, the card is not shown and the form works as before\./);
    // The card as README says it, on an answer in the server's order turned around: the rows by their badges,
    // each named without the words of its badges, and the reason on the recommended one.
    const draft = { originBusinessId: 'a', destinationBusinessId: 'b', label: null, category: null, description: null, weightKg: null, readyMin: 960, deadlineMin: 1980 };
    const option = (tags: AdviseTag[], reason?: string) => ({
      label: `${tagWords(tags)}: Relay via Etsy, $9.50`, summary: 'A summary.', kind: 'relay', customerPriceCents: 950, deliveryMin: 1972, changes: {}, tags, reason,
    });
    const card = adviceCard(
      { source: 'gemini', options: [option(['recommended'], 'A reason.'), option(['cheapest']), option(['fastest'])] }, { draft, businesses: [] },
    );
    expect(card?.rows.map((row) => [row.tags, row.label, row.summary])).toEqual([
      [['fastest'], 'Relay via Etsy, $9.50', 'A summary.'], [['cheapest'], 'Relay via Etsy, $9.50', 'A summary.'], [['recommended'], 'Relay via Etsy, $9.50', 'A reason.'],
    ]);
    expect(adviceCard({ source: 'offline', options: [option(['fastest', 'cheapest'])] }, { draft, businesses: [] })?.rows.map((row) => [row.tags, row.label]))
      .toEqual([[['fastest', 'cheapest'], 'Relay via Etsy, $9.50']]);
    // The card is drawn above the parsed note and the form (BusinessPageView), and not at all without an answer.
    const page = read('client/src/components/business/v2/page/BusinessPageView.tsx');
    expect(page.indexOf('<AdviceOptions')).toBeGreaterThan(0);
    expect(page.indexOf('<AdviceOptions')).toBeLessThan(page.indexOf('<ParsedRequestNote'));
    expect(page.indexOf('<ParsedRequestNote')).toBeLessThan(page.indexOf('<NewDeliveryForm'));
    expect(adviceCard({ source: 'offline', options: [] }, { draft, businesses: [] })).toBeNull();
  });

  it('the 2-minute demo names the card after Read my request and before Find a delivery match, with this sentence\'s two options', () => {
    const at = (text: string) => step2.indexOf(text);
    expect(at('choose **Read my request**')).toBeGreaterThan(0);
    expect(at(`Above the card, the **${ADVICE_COPY.title}** card`)).toBeGreaterThan(at('choose **Read my request**'));
    expect(at('Then choose **Find a delivery match**')).toBeGreaterThan(at(`Above the card, the **${ADVICE_COPY.title}** card`));
    const price = /^price: (.+)$/m.exec(demo)?.[1] ?? 'no price in the block';
    expect(step2).toContain(
      // #959: one relay is both the fastest and the cheapest, the balanced one is next, both at the block's price;
      // the note says why there is no direct one (#954). v2-advise-readme-demo.test.ts gets this answer on the run.
      // #960: on the card the tags are badges, so both rows have the same name.
      `for this sentence it has two options, both named "Relay via Etsy, ${price}": the first has the badges "${ADVICE_COPY.fastest}" and "${ADVICE_COPY.cheapest}" `
      + `and is marked "${ADVICE_COPY.chosen}", the second has the badge "${ADVICE_COPY.balanced}", with a note on why there is no direct one.`,
    );
    expect(step2).toContain(
      `The card lists up to three options, in the order Fastest, Cheapest, then Recommended or Balanced, and each **${ADVICE_COPY.choose}** button `
      + 'only sets the ready and deliver-by times in the form ([Options for a request](#options-for-a-request)).',
    );
    // The label is the advisor's own: the tags, then the route, then the price (advisor.ts `optionLabel`).
    expect(read('server/ai/advisor.ts')).toContain('`${tagWords(tags)}: ${routeWords(candidate, engine)}`');
  });

  it('says what goes to Gemini for the options, and that every price is the engine\'s', () => {
    const sent = gemini.split('\n').find((line) => line.startsWith('- With the key set, each sentence goes to Google')) ?? '';
    expect(sent).toContain(
      'So does each request the **Options** card asks about: the names of its two businesses, its two times, the package\'s name, type, contents and weight, '
      + 'the sentence when the call sends one, and the engine\'s plans for it (relay point, carriers\' first names, arrival, price, extra minutes, handoffs)',
    );
    expect(sent).toMatch(/Without the key nothing is sent\.$/);
    // The user turn the advisor sends (advisor.ts `buildAdviceRequest`): the sentence, the draft's facts
    // (`draftFacts`) and each plan's facts (`candidateFacts`).
    const advisor = read('server/ai/advisor.ts');
    for (const part of [
      '`The business wrote: ${', 'from: name(draft.originBusinessId)', 'to: name(draft.destinationBusinessId)',
      'readyAt: timeText(variant.readyMin)', 'deliverBy: timeText(variant.deadlineMin)',
      '{ packageName: text(draft.label) }', '{ category: text(draft.category) }', '{ contents: text(draft.description) }', '{ weightKg: draft.weightKg }',
      '{ relayPoint: relayName(candidate, engine) }', "carriers: option.carrierNames.map((name) => name.split(/\\s+/)[0])",
      'arrives: timeText(option.deliveryMin)', 'price: money(option.customerPriceCents)', 'extraMinutes: option.extraMin', 'handoffs: candidate.handoffs',
    ]) {
      expect(advisor, part).toContain(part);
    }
    expect(section).toMatch(/The matching engine computes every option\./);
    expect(advisor).toContain('customerPriceCents: plan.customerPriceCents,');
    expect(sectionOf('## Pricing')).toContain('Every price in the app (the match result, the **Options** card, the delivery details,');
    const out = sectionOf('## Assumptions and out of scope').split('\n').find((line) => line.startsWith('- Out of scope:')) ?? '';
    expect(out).toContain('an LLM never sends a request, never matches one and never sets a price');
  });
});

// #850: the README after the MVP IV UI batch (#831 Play bar on the map, #832 one-line panels with Details).
// #877: and after the post-freeze batch: the Play bar is a dark pill with the two buttons and no text (#852),
// a journey moves only the carrier handling the package (#851). Each quoted line is built by the page's own
// code or read from its source, so a reworded page fails here.
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
    expect(play).toMatch(/\*\*Play\*\* and \*\*Back to start\*\* sit in one small bar at the bottom center of the map, the Play bar: a dark translucent pill that shows the two buttons and no other text/);
    expect(watch).toMatch(/The controls are in the Play bar, a small bar at the bottom center of the map\. It is a dark translucent pill with two buttons, each an icon with its label, and no other text\./);
    expect(demo.split('\n').find((line) => line.startsWith('5. **Simulator**')) ?? '').toMatch(/The controls are at the bottom center of the map: a dark translucent pill in which \*\*Pause\*\* stops the journey where it is/);
    // #852: "a dark translucent pill" is the bar's own CSS: the ink at 72% over a blur, fully rounded.
    for (const rule of ['background: color-mix(in srgb, var(--text, #171C24) 72%, transparent)', 'backdrop-filter: blur(8px)', 'border-radius: 26px']) {
      expect(bar).toContain(rule);
    }
  });

  it('says the Play bar shows the two buttons and no other text, which is what PlaybackControls draws (#852)', () => {
    const controls = read('client/src/components/sim/v2/controls/PlaybackControls.tsx');
    // Two buttons, each an icon with its label: Play or Pause, and Back to start.
    expect(controls.match(/<button type="button"/g)).toHaveLength(2);
    expect(controls.match(/<span className="ctl-label">/g)).toHaveLength(2);
    expect(controls).toContain('<Icon d={button.label === PAUSE_LABEL ? PAUSE_ICON : PLAY_ICON} />');
    expect(controls).toContain('<Icon d={RESET_ICON} />');
    // The step line under the buttons is gone, and the two texts left are for screen readers only.
    expect(controls).not.toContain('ctl-line');
    const css = read('client/src/components/sim/v2/controls/controls.css');
    expect(css).not.toContain('.ctl-line');
    const hidden = /\.ctl-note,\s*\.ctl-status \{[^}]*\}/.exec(css)?.[0] ?? '';
    for (const rule of ['position: absolute', 'width: 1px', 'height: 1px', 'clip: rect(0 0 0 0)']) expect(hidden).toContain(rule);
    // So no sentence of the README has a line under the buttons, a step line, or the old two-line rule.
    for (const gone of [/under the (two )?buttons/, /step line/, /never takes more than two lines/, /the bar then says/]) {
      expect(readme, String(gone)).not.toMatch(gone);
    }
  });

  it('quotes the texts of network Play as the page has them: the button while it plays, the tooltip at the end', () => {
    const play = state.split('\n').find((line) => line.startsWith('In the Simulator, **Play** with no package picked')) ?? '';
    for (const text of [NETWORK_PLAYING_TEXT, FINISHED_REASON, NETWORK_FINISHED_TEXT]) expect(play, text).toContain(`"${text}"`);
    expect(play.indexOf(`"${NETWORK_PLAYING_TEXT}"`)).toBeLessThan(play.indexOf(`"${FINISHED_REASON}"`));
    // While it plays the one button reads Pause, and the sentence is the live region's.
    const playing = playButtonView({ packagePicked: false, journey: null, play: { status: 'running', overnight: false, shipmentId: null, runId: 'run' }, clock: { playing: false, timeMin: 1000 }, busy: false, simEndMin: 2160 });
    expect(playing.label).toBe('Pause');
    expect(play).toContain(`While it plays, the first button reads **Pause** (a screen reader hears "${NETWORK_PLAYING_TEXT}").`);
    // At the end of the run the button has nothing left to play: it is disabled, with FINISHED_REASON as its note.
    const atEnd = playButtonView({ packagePicked: false, journey: null, play: PLAY_IDLE, clock: { playing: false, timeMin: 2160 }, busy: false, simEndMin: 2160 });
    expect(atEnd).toEqual({ label: 'Play', action: null, note: FINISHED_REASON });
    // #852: the note is the button's tooltip (`title`) and its hidden description, no longer a line of the bar.
    expect(read('client/src/components/sim/v2/controls/PlaybackControls.tsx')).toContain('title={button.note ?? undefined}');
    expect(play).toContain(`At the end **Play** is greyed out, and hovering over it says why: "${FINISHED_REASON}" (a screen reader hears that and "${NETWORK_FINISHED_TEXT}").`);
  });

  it('says what shows a journey\'s step now: the Inspector for the eye, the step texts for a screen reader', () => {
    expect(stepAnnouncement(journey(1, 'Brooklyn Roasting Company'))).toBe('Step 2 of 4 next: Drop at relay point at Etsy.');
    const end30 = stepAnnouncement(journey(4, 'Brooklyn Roasting Company'));
    expect(watch).toContain(
      `- A screen reader still hears each step once, for example "Step 2 of 4 next: Drop at relay point at Etsy.", then "${PAUSED_TEXT}" after **Pause** and "${end30}" at the end.`,
    );
    // What a person sees is in the right panel: the step marked "Next", and the status "Delivered" at the end.
    const timeline = read('client/src/components/sim/v2/journey/JourneyTimeline.tsx');
    expect(timeline).toContain("current: 'Next'");
    expect(timeline).toContain('<span className="jt__status-label">Status</span> <strong>{journey.statusLabel}</strong>');
    expect(read('client/src/components/sim/v2/journey/journeyModel.ts')).toContain("delivered: 'Delivered',");
    expect(watch).toContain(
      '- The Play bar says nothing about the journey; the **Inspector** panel does. It marks the step the package is heading for as "Next" (printed in capitals), '
      + 'and when the journey has ended its status reads "Delivered" with the time. **Play** then plays the journey again from the start.',
    );
    // The 2-minute demo ends on what the page shows, not on a sentence only a screen reader gets.
    const step5 = demo.split('\n').find((line) => line.startsWith('5. **Simulator**')) ?? '';
    expect(step5).toContain('Let it play to the end before step 6: the first button then reads **Play** again, and the status in the **Inspector** panel on the right reads "Delivered".');
    expect(demo).not.toContain('Journey complete');
  });

  it('says a journey moves only the carrier handling the package: A in the evening, B in the morning (#851)', () => {
    const line = watch.split('\n').find((text) => text.startsWith('Each carrier is a large marker')) ?? '';
    expect(line).toContain(
      'Only the carrier handling the package moves on the map: carrier A during the evening commute, until home, and carrier B during the morning commute, '
      + 'from home to work. Neither is drawn during the other\'s commute, and no other vehicle is drawn.',
    );
    // The journey model keeps a vehicle only inside the commute window in which its carrier has the package
    // (tests/ui/sim-v2-journey-handling.test.ts plays it on the real run).
    const model = read('client/src/components/sim/v2/journey/journeyModel.ts');
    expect(model).toContain('.filter((w) => snapshotMin >= w.startMin && snapshotMin <= w.endMin)');
    expect(model).toContain('if (!c || !handling.has(m.employeeId)');
    expect(fs.existsSync(path.join(root, 'tests/ui/sim-v2-journey-handling.test.ts'))).toBe(true);
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
