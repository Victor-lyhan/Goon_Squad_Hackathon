// The study page: `client/public/study.html`, written by `npm run study` next to data/study/results.json
// (MVP IV F3, docs/mvp4.md). `data/` is gitignored, so the page carries the numbers itself and is committed.
//
// Rules of the page:
// - Pure and deterministic: the same results give the same text. No timestamp, no random id, no clock.
// - One file, no network: inline CSS, charts as inline SVG, no script, no web font (system sans fallback).
// - It shows numbers, it does not make them: totals and headline values are read from the results. The only
//   arithmetic here is presentation (a run's saving per matched package, the match rate of a group of runs,
//   a median, chart geometry), done from the exact totals with the helpers of units.ts.
// - Assumption text (label, unit, reason) is printed as it is in assumptions.ts, only HTML-escaped, so
//   tests/study/page.test.ts can check the committed page against that file.
// Colors are the MVP III palette (docs/mvp3.md, client/src/styles/tokens.css) in plain hex.
import type { Assumption, ComparisonTotals, StudyGrid, StudyResults, StudyRun } from './types';
import { MINUTES_PER_DAY, average, dollars, percent, rate, roundTo } from './units';

const COLOR = {
  bg: '#F7F7F4',
  panel: '#FFFFFF',
  ink: '#171C24',
  muted: '#5B6472',
  line: '#E3E3DE',
  relay: '#1D5075', // accent: Relay, and "a day early"
  relaySoft: '#E8EEF1', // the track behind a rate bar
  courier: '#A8ABB2', // the baseline, drawn as the quiet series
  onTime: '#0F8A5F',
  late: '#A4322A',
};

const NA = 'n/a';
const MINUS = '−';

// ---------- text ----------

/** Text for HTML content and double-quoted attributes. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 2268 -> "2,268". Not toLocaleString: the text must not depend on the machine's locale. */
const count = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** A fixed-decimal number with a real minus sign and never "-0.0". */
function fixed(value: number, decimals: number): string {
  const text = roundTo(value, decimals).toFixed(decimals);
  return text.startsWith('-') ? `${MINUS}${text.slice(1)}` : text;
}

const money = (cents: number | null): string =>
  cents === null ? NA : cents < 0 ? `${MINUS}${dollars(-cents)}` : dollars(cents);
const miles = (value: number | null): string => (value === null ? NA : `${fixed(value, 1)} mi`);
const kg = (value: number | null): string => (value === null ? NA : `${fixed(value, 2)} kg`);
const pct = (fraction: number | null): string => (fraction === null ? NA : percent(fraction));

/** A saving rate as words: 0.3744 -> "37.4% less", -0.2 -> "20.0% more". */
function lessOrMore(fraction: number | null): string {
  if (fraction === null) return NA;
  return fraction < 0 ? `${percent(-fraction)} more` : `${percent(fraction)} less`;
}

/** Minutes after midnight -> "10:30 a.m.". */
function clock(minuteOfDay: number): string {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'a.m.' : 'p.m.'}`;
}

/** Minutes since Day 1 00:00 -> "Day 2, 10:30 a.m.". */
const dayClock = (min: number): string => `Day ${Math.floor(min / MINUTES_PER_DAY) + 1}, ${clock(min % MINUTES_PER_DAY)}`;

/** 400.9 minutes -> "6 h 41 min". */
function duration(minutes: number): string {
  const whole = Math.round(Math.abs(minutes));
  const hours = Math.floor(whole / 60);
  return hours === 0 ? `${whole} min` : `${hours} h ${whole % 60} min`;
}

const list = (values: readonly number[]): string => values.join(', ');

/**
 * An assumption's value in the page's units, as the figure and the words after it: money in dollars (the list
 * holds integer cents), a time of day as a clock time with the listed minutes after it, anything else as the
 * number and its unit.
 */
export function assumptionValueParts(assumption: Assumption): { figure: string; rest: string } {
  const { value, unit } = assumption;
  if (unit.startsWith('cents')) return { figure: money(value), rest: unit.slice('cents'.length).trim() };
  if (unit.startsWith('minutes after midnight')) return { figure: clock(value), rest: `(${value} ${unit})` };
  return { figure: String(value), rest: unit };
}

// ---------- SVG pieces ----------
// Every chart is drawn in a 360-unit-wide box and scales with its column, so the text stays close to its
// CSS size at 390 px (one column) and at 1280 px (three columns).

const W = 360;
const BAR_RADIUS = 4;

/** A coordinate: at most 2 decimals, never "-0". */
const px = (value: number): string => String(roundTo(value, 2));

/** A horizontal bar from `x`: square at the baseline, rounded at the data end. Nothing for a zero width. */
function barRight(x: number, y: number, width: number, height: number, cls: string): string {
  if (width <= 0) return '';
  const r = Math.min(BAR_RADIUS, width);
  return `<path class="${cls}" d="M${px(x)} ${px(y)}h${px(width - r)}a${px(r)} ${px(r)} 0 0 1 ${px(r)} ${px(r)}v${px(height - 2 * r)}a${px(r)} ${px(r)} 0 0 1 ${px(-r)} ${px(r)}h${px(r - width)}z"/>`;
}

/** A column up from `baseY`: square at the baseline, rounded on top. */
function barUp(x: number, baseY: number, width: number, height: number, cls: string): string {
  if (height <= 0) return '';
  const r = Math.min(BAR_RADIUS, height, width / 2);
  return `<path class="${cls}" d="M${px(x)} ${px(baseY)}v${px(r - height)}a${px(r)} ${px(r)} 0 0 1 ${px(r)} ${px(-r)}h${px(width - 2 * r)}a${px(r)} ${px(r)} 0 0 1 ${px(r)} ${px(r)}v${px(height - r)}z"/>`;
}

function svg(id: string, height: number, label: string, body: string): string {
  return `<svg data-chart="${id}" viewBox="0 0 ${W} ${height}" role="img" aria-label="${escapeHtml(label)}">${body}</svg>`;
}

/** Relay next to the courier for one per-package measure: two bars from one baseline, the value at each tip. */
function pairChart(id: string, what: string, relay: number | null, courier: number | null, format: (value: number | null) => string): string {
  const labelWidth = 60;
  const valueWidth = 70;
  const barHeight = 20;
  const span = W - labelWidth - valueWidth;
  const top = Math.max(relay ?? 0, courier ?? 0);
  const rows: Array<{ name: string; value: number | null; cls: string }> = [
    { name: 'Relay', value: relay, cls: 'f-relay' },
    { name: 'Courier', value: courier, cls: 'f-courier' },
  ];
  const body = rows.map((row, index) => {
    const y = 6 + index * (barHeight + 12);
    const width = row.value === null || top <= 0 ? 0 : Math.max(0, (row.value / top) * span);
    return `<text class="t" x="0" y="${px(y + 14)}">${row.name}</text>`
      + barRight(labelWidth, y, width, barHeight, row.cls)
      + `<text class="t num" x="${px(labelWidth + width + 6)}" y="${px(y + 14)}">${format(row.value)}</text>`;
  }).join('');
  return svg(id, 64, `${what}: Relay ${format(relay)}, courier ${format(courier)}`, body);
}

/** The smallest step of the 1, 2, 2.5, 5 series that covers `min`..`max` in at most `maxBins` bins. */
function niceBins(min: number, max: number, maxBins: number): { start: number; step: number; bins: number } {
  const tolerance = 1e-9;
  for (let exponent = -4; exponent <= 9; exponent += 1) {
    for (const mantissa of [1, 2, 2.5, 5]) {
      const step = mantissa * 10 ** exponent;
      const first = Math.floor(min / step + tolerance);
      const last = Math.max(first + 1, Math.ceil(max / step - tolerance));
      if (last - first <= maxBins) return { start: roundTo(first * step, 6), step: roundTo(step, 6), bins: last - first };
    }
  }
  return { start: Math.floor(min), step: Math.max(1, Math.ceil(max - min)), bins: 1 };
}

/** Decimals needed to print multiples of `step` exactly (at most 3). */
function decimalsOf(step: number): number {
  for (let decimals = 0; decimals < 3; decimals += 1) if (roundTo(step, decimals) === step) return decimals;
  return 3;
}

/** Clean y ticks for a count axis: 0 and up to three more, the last at or above `max`. */
function countTicks(max: number): number[] {
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find(candidate => candidate * 3 >= max)
    ?? Math.ceil(max / 3);
  const ticks = [0];
  while (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

type Distribution = {
  id: string;
  /** What one value is, e.g. "cost saved per package". */
  what: string;
  values: number[];
  /** A value in full, for the summary line and the bar titles. */
  format: (value: number) => string;
  /** An axis label for a bin edge, given the decimals the step needs. */
  tick: (value: number, decimals: number) => string;
};

/** How many runs fall in each range of a per-run value: one series, so one color and no legend. */
function histogram(d: Distribution): string {
  const height = 176;
  const left = 30;
  const right = 20;
  const topY = 18;
  const baseY = 138;
  const plotWidth = W - left - right;
  if (d.values.length === 0) {
    return svg(d.id, 40, `Runs by ${d.what}: no run matched a package`, `<text class="tm" x="0" y="24">No run matched a package.</text>`);
  }
  const { start, step, bins } = niceBins(Math.min(...d.values), Math.max(...d.values), 12);
  const counts = new Array<number>(bins).fill(0);
  for (const value of d.values) {
    const index = Math.min(bins - 1, Math.max(0, Math.floor((value - start) / step + 1e-9)));
    counts[index] = counts[index]! + 1;
  }
  const ticks = countTicks(Math.max(...counts));
  const topCount = ticks[ticks.length - 1]!;
  const yOf = (value: number): number => baseY - (value / topCount) * (baseY - topY);
  const slot = plotWidth / bins;
  const barWidth = Math.min(24, slot - 2);
  const decimals = decimalsOf(step);
  const edge = (index: number): number => roundTo(start + index * step, 6);
  const peak = counts.indexOf(Math.max(...counts));
  // Label every edge only where the widest label fits in a slot (about 7.5 units per character and a gap).
  let widest = 0;
  for (let index = 0; index <= bins; index += 1) widest = Math.max(widest, d.tick(edge(index), decimals).length);
  const labelEvery = Math.max(1, Math.ceil((widest * 7.5 + 8) / slot));

  const grid = ticks.map(tick =>
    `<line class="grid" x1="${left}" x2="${W - right}" y1="${px(yOf(tick))}" y2="${px(yOf(tick))}"/>`
    + `<text class="tm num" x="${left - 6}" y="${px(yOf(tick) + 4)}" text-anchor="end">${tick}</text>`).join('');
  const bars = counts.map((value, index) => {
    if (value === 0) return '';
    const x = left + index * slot + (slot - barWidth) / 2;
    const title = `${d.format(edge(index))} to ${d.format(edge(index + 1))}: ${value} ${value === 1 ? 'run' : 'runs'}`;
    return `<g><title>${escapeHtml(title)}</title>${barUp(x, baseY, barWidth, baseY - yOf(value), 'f-relay')}</g>`
      + (index === peak ? `<text class="t num" x="${px(x + barWidth / 2)}" y="${px(yOf(value) - 5)}" text-anchor="middle">${value}</text>` : '');
  }).join('');
  let edges = '';
  for (let index = 0; index <= bins; index += 1) {
    const x = left + index * slot;
    edges += `<line class="grid" x1="${px(x)}" x2="${px(x)}" y1="${baseY}" y2="${baseY + 4}"/>`;
    if (index % labelEvery === 0) {
      edges += `<text class="tm num" x="${px(x)}" y="${baseY + 17}" text-anchor="middle">${d.tick(edge(index), decimals)}</text>`;
    }
  }
  const axisTitle = `<text class="tm" x="${px(left + plotWidth / 2)}" y="${height - 6}" text-anchor="middle">${escapeHtml(d.what)}</text>`
    + `<text class="tm" x="0" y="10">runs</text>`;
  const sorted = [...d.values].sort((a, b) => a - b);
  const label = `Runs by ${d.what}: ${d.values.length} runs, from ${d.format(sorted[0]!)} to ${d.format(sorted[sorted.length - 1]!)}`;
  return svg(d.id, height, label, grid + bars + edges + axisTitle);
}

/** Median, range and how many runs Relay won, under a histogram. */
function distributionSummary(d: Distribution): string {
  if (d.values.length === 0) return '';
  const sorted = [...d.values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  const ahead = d.values.filter(value => value > 0).length;
  return `<p class="note">Median ${d.format(median)} · range ${d.format(sorted[0]!)} to ${d.format(sorted[sorted.length - 1]!)} · `
    + `Relay ahead in ${ahead} of ${d.values.length} runs</p>`;
}

/** A rate per named row against the same whole (0 to 100%): a bar on a lighter track, the figure at the end. */
function rateRows(id: string, what: string, rows: Array<{ name: string; fraction: number | null }>): string {
  const labelWidth = 104;
  const valueWidth = 50;
  const barHeight = 14;
  const rowHeight = 26;
  const span = W - labelWidth - valueWidth;
  const body = rows.map((row, index) => {
    const y = 4 + index * rowHeight;
    const width = row.fraction === null ? 0 : Math.max(0, Math.min(1, row.fraction)) * span;
    return `<text class="t" x="0" y="${px(y + 11)}">${escapeHtml(row.name)}</text>`
      + `<rect class="f-track" x="${labelWidth}" y="${px(y)}" width="${span}" height="${barHeight}" rx="${BAR_RADIUS}"/>`
      + barRight(labelWidth, y, width, barHeight, 'f-relay')
      + `<text class="t num" x="${W}" y="${px(y + 11)}" text-anchor="end">${pct(row.fraction)}</text>`;
  }).join('');
  const label = `${what}: ${rows.map(row => `${row.name} ${pct(row.fraction)}`).join(', ')}`;
  return svg(id, rows.length * rowHeight + 2, label, body);
}

type Part = { name: string; value: number; cls: string };

/** One whole split into parts: each part its own block, its share printed on it where it fits. */
function segmentedBar(id: string, what: string, parts: Part[]): string {
  const height = 28;
  const gap = 2;
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const shown = parts.filter(part => part.value > 0);
  const span = W - gap * Math.max(0, shown.length - 1);
  let x = 0;
  const body = shown.map(part => {
    const width = (part.value / total) * span;
    const share = pct(rate(part.value, total));
    const block = `<g><title>${escapeHtml(`${part.name}: ${count(part.value)} (${share})`)}</title>`
      + `<rect class="${part.cls}" x="${px(x)}" y="0" width="${px(width)}" height="${height}" rx="${BAR_RADIUS}"/></g>`
      + (width >= 52 ? `<text class="t-on num" x="${px(x + 8)}" y="18">${share}</text>` : '');
    x += width + gap;
    return block;
  }).join('');
  const label = `${what}: ${parts.map(part => `${part.name} ${count(part.value)}`).join(', ')}`;
  return svg(id, height, label, total === 0 ? `<text class="tm" x="0" y="18">No package matched.</text>` : body);
}

// ---------- sections ----------

function tile(label: string, value: string, detail: string): string {
  return `<div class="tile"><p class="tile-label">${label}</p><p class="tile-value">${value}</p><p class="tile-detail">${detail}</p></div>`;
}

function figure(title: string, chart: string, note = ''): string {
  return `<figure class="card"><figcaption>${title}</figcaption>${chart}${note}</figure>`;
}

/** The match rate of the runs that share one grid value, from their exact counts. */
function groupRates(runs: readonly StudyRun[], values: readonly number[], pick: (run: StudyRun) => number, name: (value: number) => string) {
  return values.map(value => {
    const group = runs.filter(run => pick(run) === value);
    const requested = group.reduce((sum, run) => sum + run.totals.packages, 0);
    const matched = group.reduce((sum, run) => sum + run.totals.matched, 0);
    return { name: name(value), fraction: rate(matched, requested) };
  });
}

/** A run's saving per matched package; runs that matched nothing have no value. */
function perMatched(runs: readonly StudyRun[], total: (totals: ComparisonTotals) => number): number[] {
  return runs.filter(run => run.totals.matched > 0).map(run => total(run.totals) / run.totals.matched);
}

function assumptionRows(assumptions: readonly Assumption[]): string {
  return assumptions.map(assumption =>
    `<tr data-key="${escapeHtml(assumption.key)}">`
    + `<th scope="row">${escapeHtml(assumption.label)}<code>${escapeHtml(assumption.key)}</code></th>`
    + `<td class="value"><b class="num">${escapeHtml(assumptionValueParts(assumption).figure)}</b> ${escapeHtml(assumptionValueParts(assumption).rest)}</td>`
    + `<td>${escapeHtml(assumption.reason)}</td></tr>`).join('\n');
}

function runRows(runs: readonly StudyRun[]): string {
  return runs.map(({ id, params, totals: t }) => {
    const per = (total: number, decimals: number): number | null => average(total, t.matched, decimals);
    return `<tr><th scope="row">${escapeHtml(id)}</th><td>${params.employees}</td><td>${params.packages}</td><td>${params.maxExtraMin} min</td>`
      + `<td>${t.matched}</td><td>${pct(t.matchRate)}</td>`
      + `<td>${money(per(t.costSavedCents, 0))}</td>`
      + `<td>${miles(per(t.relayAddedMiles, 3))}</td><td>${miles(per(t.courierMiles, 3))}</td>`
      + `<td>${kg(per(t.relayCo2Kg, 3))}</td><td>${kg(per(t.courierCo2Kg, 3))}</td>`
      + `<td>${t.early}</td><td>${t.onTime}</td><td>${t.late}</td></tr>`;
  }).join('\n');
}

function skippedBlock(grid: StudyGrid): string {
  if (grid.skippedRuns.length === 0) return '';
  const items = grid.skippedRuns.map(run => `<li><code>${escapeHtml(run.id)}</code> ${escapeHtml(run.reason)}</li>`).join('\n');
  return `<details><summary>The ${count(grid.skippedRuns.length)} skipped ${grid.skippedRuns.length === 1 ? 'run' : 'runs'}</summary><ul class="skipped">\n${items}\n</ul></details>`;
}

const CSS = `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:${COLOR.bg};color:${COLOR.ink};font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5}
main{max-width:1120px;margin:0 auto;padding:20px 20px 56px}
a{color:${COLOR.relay}}
a:focus-visible,summary:focus-visible{outline:2px solid ${COLOR.relay};outline-offset:2px}
.back{display:inline-block;font-size:14px;font-weight:600;text-decoration:none;padding:6px 0}
.back:hover{text-decoration:underline}
h1{font-size:30px;line-height:1.2;margin:20px 0 8px;font-weight:600;letter-spacing:-0.01em}
h2{font-size:19px;line-height:1.3;margin:40px 0 4px;font-weight:600}
p{margin:0 0 12px}
.lede{font-size:17px;color:${COLOR.muted};max-width:760px}
.intro{color:${COLOR.muted};max-width:760px}
.how{max-width:760px}
.num,code{font-family:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:24px 0 0}
.tile,.card{background:${COLOR.panel};border:1px solid ${COLOR.line};border-radius:6px}
.tile{padding:14px 16px}
.tile p{margin:0}
.tile-label{font-size:13px;color:${COLOR.muted}}
.tile-value{font-size:26px;line-height:1.25;font-weight:600;margin:2px 0 4px}
.tile-detail{font-size:13px;color:${COLOR.muted}}
.grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-top:12px}
.card{margin:0;padding:14px 16px 12px;min-width:0}
figcaption{font-size:14px;font-weight:600;margin-bottom:10px}
svg{display:block;width:100%;height:auto;max-width:460px}
svg text{font-size:12px}
.t{fill:${COLOR.ink}}
.tm{fill:${COLOR.muted}}
.t-on{fill:#FFFFFF;font-weight:600}
.grid{stroke:${COLOR.line};stroke-width:1}
.f-relay{fill:${COLOR.relay}}
.f-courier{fill:${COLOR.courier}}
.f-track{fill:${COLOR.relaySoft}}
.f-ontime{fill:${COLOR.onTime}}
.f-late{fill:${COLOR.late}}
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;list-style:none;margin:10px 0 0;padding:0;font-size:13px;color:${COLOR.muted}}
.legend li{display:flex;align-items:center;gap:6px}
.swatch{display:inline-block;width:10px;height:10px;border-radius:2px;flex:none}
.note{font-size:13px;color:${COLOR.muted};margin:10px 0 0}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px 20px;margin:16px 0 0;max-width:760px}
.facts div{border-top:1px solid ${COLOR.line};padding-top:6px}
.facts dt{font-size:13px;color:${COLOR.muted}}
.facts dd{margin:0;font-weight:600}
.scroll{overflow-x:auto;margin-top:12px;background:${COLOR.panel};border:1px solid ${COLOR.line};border-radius:6px}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;vertical-align:top;padding:10px 14px;border-top:1px solid ${COLOR.line}}
thead th{border-top:0;font-size:12px;font-weight:600;color:${COLOR.muted};white-space:nowrap}
tbody th{font-weight:600}
.assumptions tbody th{width:26%}
.assumptions .value{width:24%}
.assumptions .value b{font-weight:600}
.assumptions code{display:block;margin-top:2px;font-size:12px;font-weight:400;color:${COLOR.muted};overflow-wrap:anywhere}
.runs{font-size:13px;font-variant-numeric:tabular-nums}
.runs th,.runs td{padding:6px 10px;white-space:nowrap}
.runs td{text-align:right;font-family:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.runs thead th{text-align:right}
.runs thead th:first-child{text-align:left}
details{margin-top:12px}
summary{cursor:pointer;font-weight:600;color:${COLOR.relay};padding:6px 0}
.skipped{font-size:13px;color:${COLOR.muted};padding-left:20px}
footer{margin-top:40px;padding-top:12px;border-top:1px solid ${COLOR.line};font-size:13px;color:${COLOR.muted}}
@media (max-width:640px){
main{padding:12px 16px 40px}
h1{font-size:25px}
.assumptions thead{display:none}
.assumptions tr{display:block;padding:12px 14px;border-top:1px solid ${COLOR.line}}
.assumptions tbody tr:first-child{border-top:0}
.assumptions th,.assumptions td{display:block;width:auto!important;padding:0;border:0}
.assumptions .value{margin:4px 0}
}
`;

/** The whole page for one set of study results. Pure: same results, same text. */
export function renderStudyPage(results: StudyResults): string {
  const { assumptions, grid, runs, totals, headline: h } = results;
  const skipped = grid.skippedRuns.length;
  const promiseAssumption = assumptions.find(assumption => assumption.key === 'courierPromisedByMin');
  const promiseClock = promiseAssumption ? clock(promiseAssumption.value) : NA;
  const promisedByMin = promiseAssumption ? MINUTES_PER_DAY + promiseAssumption.value : null;
  const requestWindow = grid.requestWindow;
  const noMatchRuns = runs.filter(run => run.totals.matched === 0).length;

  const tiles = [
    tile('Cost to the sender', lessOrMore(h.costSavedRate),
      `Relay ${money(h.relayCostPerPackageCents)} vs courier ${money(h.courierCostPerPackageCents)} per package`),
    tile('Added vehicle miles', lessOrMore(h.milesSavedRate),
      `Relay ${miles(h.relayAddedMilesPerPackage)} vs courier ${miles(h.courierMilesPerPackage)} per package`),
    tile('CO₂', lessOrMore(h.co2SavedRate),
      `Relay ${kg(h.relayCo2KgPerPackage)} vs courier ${kg(h.courierCo2KgPerPackage)} per package`),
    tile('Delivered by the courier’s promised time', pct(h.onTimeOrEarlyRate),
      `${pct(h.earlyRate)} a day early, ${pct(h.lateRate)} late`),
    tile('Match rate', pct(h.matchRate),
      `${count(h.matched)} of ${count(h.packages)} packages found a commute`),
  ].join('\n');

  const pairs = [
    figure('Cost to the sender, per package',
      pairChart('cost', 'Cost to the sender per package', h.relayCostPerPackageCents, h.courierCostPerPackageCents, money),
      `<p class="note">Relay saves ${money(h.costSavedPerPackageCents)} per package.</p>`),
    figure('Added vehicle miles, per package',
      pairChart('miles', 'Added vehicle miles per package', h.relayAddedMilesPerPackage, h.courierMilesPerPackage, miles),
      `<p class="note">Relay adds ${miles(h.milesSavedPerPackage)} less driving per package.</p>`),
    figure('CO₂, per package',
      pairChart('co2', 'CO₂ per package', h.relayCo2KgPerPackage, h.courierCo2KgPerPackage, kg),
      `<p class="note">Relay emits ${kg(h.co2SavedKgPerPackage)} less per package.</p>`),
  ].join('\n');

  const distributions: Array<Distribution & { title: string }> = [
    {
      id: 'runs-cost', title: 'Cost saved per package', what: 'cost saved per package',
      values: perMatched(runs, t => t.costSavedCents).map(cents => cents / 100),
      format: value => money(Math.round(value * 100)),
      tick: (value, decimals) => `${value < 0 ? MINUS : ''}$${Math.abs(value).toFixed(decimals === 0 ? 0 : 2)}`,
    },
    {
      id: 'runs-miles', title: 'Miles saved per package', what: 'miles saved per package',
      values: perMatched(runs, t => t.milesSaved),
      format: miles,
      tick: (value, decimals) => fixed(value, decimals),
    },
    {
      id: 'runs-co2', title: 'CO₂ saved per package, kg', what: 'kg of CO₂ saved per package',
      values: perMatched(runs, t => t.co2SavedKg),
      format: kg,
      tick: (value, decimals) => fixed(value, decimals),
    },
  ];
  const histograms = distributions.map(d => figure(d.title, histogram(d), distributionSummary(d))).join('\n');

  const matchCharts = [
    figure('By number of commuting employees',
      rateRows('match-employees', 'Match rate by number of employees', groupRates(runs, grid.employeeCounts, run => run.params.employees, value => `${value} employees`))),
    figure('By number of packages requested',
      rateRows('match-packages', 'Match rate by number of packages', groupRates(runs, grid.packageCounts, run => run.params.packages, value => `${value} packages`))),
    figure('By detour limit per commute',
      rateRows('match-detour', 'Match rate by detour limit', groupRates(runs, grid.detourLimitsMin, run => run.params.maxExtraMin, value => `${value} min detour`))),
  ].join('\n');

  const timingParts: Part[] = [
    { name: 'A day early', value: totals.early, cls: 'f-relay' },
    { name: 'On time', value: totals.onTime, cls: 'f-ontime' },
    { name: 'Late', value: totals.late, cls: 'f-late' },
  ];
  const timingLegend = [
    { cls: COLOR.relay, text: `A day early: delivered the day it was sent · ${count(totals.early)} (${pct(h.earlyRate)})` },
    { cls: COLOR.onTime, text: `On time: the next day by ${promiseClock} · ${count(totals.onTime)} (${pct(rate(totals.onTime, totals.matched))})` },
    { cls: COLOR.late, text: `Late: after ${promiseClock} · ${count(totals.late)} (${pct(h.lateRate)})` },
  ].map(item => `<li><span class="swatch" style="background:${item.cls}"></span>${item.text}</li>`).join('');
  const ahead = h.avgMinutesAheadOfPromise;
  const aheadText = ahead === null ? ''
    : `<p>On average a Relay package arrives ${duration(ahead)} ${ahead < 0 ? 'after' : 'before'} the courier’s promised time.</p>`;
  const windowText = requestWindow === null || promisedByMin === null ? ''
    : requestWindow.latestDeadlineMin <= promisedByMin
      ? `<p>Why nothing is late here: Relay only accepts a package it can deliver by the sender’s deadline. `
        + `The simulated packages were ready from ${dayClock(requestWindow.earliestReadyMin)} and every deadline was at or before ${dayClock(requestWindow.latestDeadlineMin)}, `
        + `which is no later than the courier’s promise (${dayClock(promisedByMin)}), so a matched package cannot be late. `
        + `The price of that rule is the match rate above, not lateness.</p>`
      : `<p>Relay only accepts a package it can deliver by the sender’s deadline. The simulated packages were ready from ${dayClock(requestWindow.earliestReadyMin)}, `
        + `the latest deadline was ${dayClock(requestWindow.latestDeadlineMin)} and the courier’s promise is ${dayClock(promisedByMin)}, so a matched package can be later than the courier.</p>`;

  const facts = [
    ['Runs simulated', count(totals.runs)],
    ['Runs skipped', count(skipped)],
    ['Packages requested', count(totals.packages)],
    ['Matched and compared', count(totals.matched)],
    ['Carried on one commute', count(totals.direct)],
    ['Carried on two commutes, one relay point', count(totals.relay)],
  ].map(([name, value]) => `<div><dt>${name}</dt><dd class="num">${value}</dd></div>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Relay compared with a standard next-day B2B courier on cost, added miles, CO₂ and delivery time, with every assumption listed.">
<meta name="theme-color" content="${COLOR.relay}">
<title>Relay vs. a next-day courier: the numbers</title>
<style>${CSS}</style>
</head>
<body>
<main>
<a class="back" href="/">← Back to Relay</a>
<h1>Relay vs. a next-day courier: the numbers</h1>
<p class="lede">The same packages sent two ways: on a commute an employee already drives, or on a dedicated courier trip. ${count(totals.runs)} simulated runs, ${count(totals.matched)} packages compared.</p>

<section class="tiles" aria-label="Headline numbers">
${tiles}
</section>

<section>
<h2>How we compared</h2>
<p class="how">Each run is a full two-day Relay simulation of a random New York City scenario, on the committed cache of driving distances.
We ran every combination of seeds ${list(grid.seeds)}; ${list(grid.employeeCounts)} commuting employees; ${list(grid.packageCounts)} packages; and detour limits of ${list(grid.detourLimitsMin)} minutes per commute:
${count(grid.plannedRuns)} runs planned, ${count(grid.completedRuns)} simulated, ${count(skipped)} skipped (a skipped run needs a driving distance the cache does not have; it is never estimated).
For every package Relay matched to a commute, the baseline is the same package sent with a <strong>standard next-day B2B courier</strong>: one dedicated trip from sender to recipient, promised by ${promiseClock} on the next business day. It is <strong>not a same-hour courier</strong>.
“Per package” always means per package Relay matched. A package with no suitable commute would go by courier at the courier’s price, so it is left out of the comparison and counted in the match rate instead.
Every number that is not travel data or simulation output is in the <a href="#assumptions">assumptions table</a>.</p>
<dl class="facts">${facts}</dl>
${skippedBlock(grid)}
</section>

<section>
<h2>Per package: cost, added miles and CO₂</h2>
<p class="intro">Averages over all ${count(totals.matched)} matched packages. Shorter is better.</p>
<ul class="legend"><li><span class="swatch" style="background:${COLOR.relay}"></span>Relay, on a commute</li><li><span class="swatch" style="background:${COLOR.courier}"></span>Next-day courier, dedicated trip</li></ul>
<div class="grid3">
${pairs}
</div>
</section>

<section>
<h2>How much the saving varies from run to run</h2>
<p class="intro">One value per run: what Relay saved per matched package in that run. Each column counts the runs in that range; a value below zero means the courier was ahead in that run.${noMatchRuns > 0 ? ` ${count(noMatchRuns)} ${noMatchRuns === 1 ? 'run' : 'runs'} matched no package and ${noMatchRuns === 1 ? 'is' : 'are'} not shown.` : ''}</p>
<div class="grid3">
${histograms}
</div>
</section>

<section>
<h2>Match rate: ${pct(h.matchRate)}</h2>
<p class="intro">Relay matched ${count(totals.matched)} of ${count(totals.packages)} requested packages to a commute; the other ${count(totals.unmatched)} would go by courier. The rate depends on how many employees commute, how many packages are asked for and how long a detour is allowed.</p>
<div class="grid3">
${matchCharts}
</div>
</section>

<section>
<h2>On time against the courier’s promised window</h2>
<p class="intro">The courier promises delivery by ${promiseClock} on the next business day and is assumed to always keep that promise. Each matched package is early, on time or late against it.</p>
<div class="grid3">
<figure class="card"><figcaption>${count(totals.matched)} matched packages</figcaption>${segmentedBar('timing', 'Relay delivery time against the courier’s promise', timingParts)}<ul class="legend">${timingLegend}</ul></figure>
<div class="how">${aheadText}${windowText}</div>
</div>
</section>

<section id="assumptions">
<h2>Assumptions</h2>
<p class="intro">Every number the comparison uses that is not travel data or simulation output, with the reason for its value and the side it favours.</p>
<div class="scroll">
<table class="assumptions">
<thead><tr><th scope="col">Assumption</th><th scope="col">Value</th><th scope="col">Why this value</th></tr></thead>
<tbody>
${assumptionRows(assumptions)}
</tbody>
</table>
</div>
</section>

<section>
<h2>Every run</h2>
<details>
<summary>Show the ${count(runs.length)} simulated ${runs.length === 1 ? 'run' : 'runs'} as a table</summary>
<div class="scroll">
<table class="runs">
<thead><tr><th scope="col">Run</th><th scope="col">Employees</th><th scope="col">Packages</th><th scope="col">Detour limit</th><th scope="col">Matched</th><th scope="col">Match rate</th><th scope="col">Cost saved / pkg</th><th scope="col">Relay added mi / pkg</th><th scope="col">Courier mi / pkg</th><th scope="col">Relay CO₂ / pkg</th><th scope="col">Courier CO₂ / pkg</th><th scope="col">Early</th><th scope="col">On time</th><th scope="col">Late</th></tr></thead>
<tbody>
${runRows(runs)}
</tbody>
</table>
</div>
</details>
</section>

<footer>Generated by <code>npm run study</code> from the study results. Run ids read s (seed), e (employees), p (packages), d (detour limit in minutes). <a href="/">Back to Relay</a></footer>
</main>
</body>
</html>
`;
}
