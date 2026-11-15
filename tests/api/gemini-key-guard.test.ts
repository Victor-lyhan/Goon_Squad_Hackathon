// The MVP IV F1 key rule (docs/mvp4.md, "Keys") as a build check: GEMINI_API_KEY and GEMINI_MODEL are server
// only. This file reads the repo's source as text and fails when the key could reach
//   1. the browser: any file under client/ that mentions Gemini or its API host;
//   2. a URL: server/ or scripts/ code that puts a `key` query parameter on a Gemini request;
//   3. a log: a console/logger call in server/ or scripts/ whose arguments mention the key;
//   4. a commit or the bundle: a `VITE_` name with GEMINI in it, a Vite config that mentions Gemini, a `.env` in git.
// Each matcher is a pure function with fixture cases next to the repo scan, so a matcher that stops matching is
// seen too. A failure lists `file:line` and the rule, never the text of the line (it could hold a key).
// Nothing here reads `.env`, the network or a key.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');

interface Hit {
  line: number;
  rule: string;
}

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;
const rulesOf = (hits: Hit[]): string[] => hits.map((hit) => hit.rule);

/** Every file under `dir` (repo-relative, `/` separators), sorted; folders named in `skip` are left out. */
function walk(dir: string, skip: ReadonlySet<string>): string[] {
  const absolute = path.join(root, dir);
  if (!fs.existsSync(absolute)) return [];
  return fs
    .readdirSync(absolute, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((entry) => {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return skip.has(entry.name) ? [] : walk(relative, skip);
      return entry.isFile() ? [relative] : [];
    });
}

/** Build output and installed packages are not source (and `dist/` is gitignored). */
const NOT_SOURCE = new Set(['node_modules', 'dist']);

/** `file:line rule` for every hit of `find` in `files`. Files are read as bytes (latin1), so any file can be read. */
function scan(files: string[], find: (text: string) => Hit[]): string[] {
  return files.flatMap((file) =>
    find(fs.readFileSync(path.join(root, file), 'latin1')).map((hit) => `${file}:${hit.line} ${hit.rule}`),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Client code
// ---------------------------------------------------------------------------------------------------------------

const CLIENT_GEMINI =
  'mentions Gemini: client code may only hold the label "Parsed by Gemini" and the source value \'gemini\'';
const CLIENT_HOST = 'names the Gemini API host: only the server may call it';

/**
 * The two mentions client code needs, and nothing else: docs/mvp4.md asks for a "Parsed by Gemini" label on the
 * card, and the parse-request answer says `source: 'gemini' | 'offline'` (shared/v2/parseRequest.ts, #764).
 * Both are case-sensitive, so `GEMINI_API_KEY`, `geminiKey` or a comment about Gemini still fail.
 */
const CLIENT_MAY_SAY = [/Parsed by Gemini/g, /(['"`])gemini\1/g];

function clientHits(text: string): Hit[] {
  const hits: Hit[] = [];
  text.split('\n').forEach((line, index) => {
    const rest = CLIENT_MAY_SAY.reduce((left, allowed) => left.replace(allowed, ' '), line);
    if (/gemini/i.test(rest)) hits.push({ line: index + 1, rule: CLIENT_GEMINI });
    if (/generativelanguage/i.test(line)) hits.push({ line: index + 1, rule: CLIENT_HOST });
  });
  return hits;
}

describe('Gemini key rule: client code', () => {
  it('catches the key name, a Gemini variable and a comment in any case', () => {
    for (const bad of [
      'const key = import.meta.env.GEMINI_API_KEY;',
      'const model = process.env.GEMINI_MODEL;',
      'const { geminiKey } = await res.json();',
      'headers: { "x-goog-api-key": geminiApiKey },',
      '// ask gemini directly from the page',
      '<p>Powered by Gemini</p>',
      '.gemini-badge { color: red; }',
      "const source = 'Gemini';",
      "const a = 'gemini' + geminiKey;",
    ]) {
      expect(rulesOf(clientHits(bad)), bad).toStrictEqual([CLIENT_GEMINI]);
    }
  });

  it('catches the Gemini API host, with or without the word Gemini', () => {
    expect(rulesOf(clientHits('fetch("https://generativelanguage.googleapis.com/v1beta/models");'))).toStrictEqual([CLIENT_HOST]);
    expect(rulesOf(clientHits('const HOST = "GenerativeLanguage.googleapis.com";'))).toStrictEqual([CLIENT_HOST]);
    expect(rulesOf(clientHits('fetch(`https://generativelanguage.googleapis.com/gemini-2.5-flash`)'))).toStrictEqual([CLIENT_GEMINI, CLIENT_HOST]);
  });

  it('gives the line of each hit', () => {
    expect(clientHits('const a = 1;\nconst b = 2;\nconst c = GEMINI_API_KEY;\n')).toStrictEqual([{ line: 3, rule: CLIENT_GEMINI }]);
  });

  it('lets the label and the source value through, and nothing next to them', () => {
    for (const fine of [
      "const label = draft.source === 'gemini' ? 'Parsed by Gemini' : 'Parsed offline';",
      '<span className="tag">Parsed by Gemini</span>',
      'type Source = "gemini" | "offline";',
      'const SOURCES = [`gemini`, `offline`];',
      'const key = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY;',
    ]) {
      expect(clientHits(fine), fine).toStrictEqual([]);
    }
    expect(rulesOf(clientHits("source === 'gemini' // the Gemini answer"))).toStrictEqual([CLIENT_GEMINI]);
    expect(rulesOf(clientHits('<span>Parsed by Gemini 2.5 (gemini-2.5-flash)</span>'))).toStrictEqual([CLIENT_GEMINI]);
    expect(rulesOf(clientHits('<span>PARSED BY GEMINI</span>'))).toStrictEqual([CLIENT_GEMINI]);
  });

  it('no file under client/ (source, index.html and client/public/) mentions Gemini or its API host', () => {
    const files = walk('client', NOT_SOURCE);
    // The walk really is over the client: a wrong root would otherwise pass with nothing read.
    expect(files).toContain('client/index.html');
    expect(files).toContain('client/src/App.tsx');
    expect(files.length).toBeGreaterThan(100);
    expect(files.filter((file) => /(^|\/)(node_modules|dist)\//.test(file))).toStrictEqual([]);
    expect(scan(files, clientHits)).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 2 and 3. Server and script code
// ---------------------------------------------------------------------------------------------------------------

interface Lexed {
  /** The source with comments blanked (same length, same lines); strings are kept. */
  code: string;
  /** `code` with the text of strings, template chunks and regex literals blanked too: only "real" code is left. */
  bare: string;
  /** The text of every string literal and of every static chunk of a template, with where it starts. */
  strings: { start: number; text: string }[];
  /** Null when the file was read cleanly to its end, else what was left open (so a misread file is never a pass). */
  problem: string | null;
}

/** A `/` after one of these words starts a regex, not a division. */
const REGEX_AFTER = new Set(['return', 'typeof', 'case', 'in', 'of', 'void', 'delete', 'throw', 'new', 'else', 'do', 'yield', 'await', 'instanceof']);

/**
 * A small reader of TypeScript text (no JSX): it knows comments, strings, templates with `${}` and regex
 * literals, which is what the checks below need to tell a comment about `?key=` from a URL with one.
 * (`typescript` 7 has no stable parser API to import, so this stays local and small.)
 */
function lex(source: string): Lexed {
  const n = source.length;
  const code = source.split('');
  const bare = source.split('');
  const strings: Lexed['strings'] = [];
  let problem: string | null = null;
  const blank = (chars: string[], from: number, to: number): void => {
    for (let k = from; k < to && k < n; k++) if (chars[k] !== '\n' && chars[k] !== '\r') chars[k] = ' ';
  };
  const piece = (from: number, to: number): void => {
    strings.push({ start: from, text: source.slice(from, to) });
    blank(bare, from, to);
  };
  const fail = (what: string, at: number): void => {
    problem ??= `${what} that starts on line ${lineOf(source, at)}`;
  };
  /** One entry per open `${`: how many `{` are open inside it. */
  const open: number[] = [];
  /** True when the last thing read was a value, so a `/` after it divides. */
  let afterValue = false;
  let i = 0;

  /** Reads the static text of a template from `from` to its closing backtick or its next `${`. */
  const templateChunk = (from: number): number => {
    let j = from;
    while (j < n) {
      const c = source[j];
      if (c === '\\') {
        j += 2;
      } else if (c === '`') {
        piece(from, j);
        afterValue = true;
        return j + 1;
      } else if (c === '$' && source[j + 1] === '{') {
        piece(from, j);
        open.push(0);
        afterValue = false;
        return j + 2;
      } else {
        j++;
      }
    }
    fail('a template with no end', from);
    return n;
  };

  while (i < n) {
    const c = source[i] ?? '';
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      const newline = source.indexOf('\n', i);
      const end = newline === -1 ? n : newline;
      blank(code, i, end);
      blank(bare, i, end);
      i = end;
      continue;
    }
    if (c === '/' && next === '*') {
      const close = source.indexOf('*/', i + 2);
      if (close === -1) fail('a comment with no end', i);
      const end = close === -1 ? n : close + 2;
      blank(code, i, end);
      blank(bare, i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
      if (source[j] !== c) fail('a string with no end', i);
      piece(i + 1, Math.min(j, n));
      i = j + 1;
      afterValue = true;
      continue;
    }
    if (c === '`') {
      i = templateChunk(i + 1);
      continue;
    }
    if (open.length > 0 && (c === '{' || c === '}')) {
      const top = open.length - 1;
      const depth = open[top] ?? 0;
      if (c === '}' && depth === 0) {
        open.pop();
        i = templateChunk(i + 1);
        continue;
      }
      open[top] = depth + (c === '{' ? 1 : -1);
    }
    if (c === '/' && !afterValue) {
      let j = i + 1;
      let inClass = false;
      while (j < n && source[j] !== '\n' && (inClass || source[j] !== '/')) {
        if (source[j] === '\\') j++;
        else if (source[j] === '[') inClass = true;
        else if (source[j] === ']') inClass = false;
        j++;
      }
      if (source[j] === '/') {
        blank(bare, i + 1, j);
        i = j + 1;
        while (/[a-z]/.test(source[i] ?? '')) i++;
        afterValue = true;
        continue;
      }
      // No closing `/` on the line: it was a division after all.
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[\w$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(source[j] ?? '')) j++;
      afterValue = !REGEX_AFTER.has(source.slice(i, j));
      i = j;
      continue;
    }
    afterValue = c === ')' || c === ']' || c === '}';
    i++;
  }
  if (open.length > 0) fail('a template expression with no end', n - 1);
  return { code: code.join(''), bare: bare.join(''), strings, problem };
}

const URL_KEY = 'puts a key in the query of a Gemini request: send it in the x-goog-api-key header only';
const LOG_KEY =
  'passes something named like the API key to a log call: log a fixed line built elsewhere, never the key or its name';

/** Code (comments left out) that has to do with Gemini: only such a file is held to the URL rule. */
const GEMINI_CODE = /generativelanguage|gemini|generateContent/i;

/**
 * A Gemini request with a `key` query parameter. The rule covers the whole file, not one line, because the host
 * is usually a constant and the URL is built somewhere else: in a file whose code mentions Gemini, no string or
 * template may hold `?key=` / `&key=`, and no `URLSearchParams` or `searchParams.set` may add a `key`.
 * Comments and regex literals do not count (a comment may say "never ?key="; a redactor may match it).
 */
function urlKeyHits(lexed: Lexed): Hit[] {
  if (!GEMINI_CODE.test(lexed.code)) return [];
  const at: number[] = [];
  for (const piece of lexed.strings) {
    const found = /(?:^|[?&])key=/i.exec(piece.text);
    if (found) at.push(piece.start + found.index);
  }
  for (const found of lexed.code.matchAll(/searchParams\s*\.\s*(?:set|append)\s*\(\s*(['"`])key\1/g)) at.push(found.index);
  for (const found of lexed.code.matchAll(/URLSearchParams\s*\(\s*(?:\{[^{}]*(?<![\w$.])['"]?key['"]?\s*[:,}]|\[\s*\[\s*['"`]key['"`])/g)) {
    at.push(found.index);
  }
  return at.sort((a, b) => a - b).map((index) => ({ line: lineOf(lexed.code, index), rule: URL_KEY }));
}

/** `a.b.c(` or `c(`: the dotted name in front of an opening parenthesis. */
const CALL = /(?<![\w$])((?:[\w$]+\s*\??\.\s*)*[\w$]+)\s*(?:\?\.\s*)?\(/g;
const LOG_OWNER = /^(?:console|logger|log|stdout|stderr)$/i;
const LOG_METHOD = /^(?:log|out|print|debug|info|warn|error|trace|(?:log|print|warn)[A-Z_][\w$]*)$/;
/** `GEMINI_API_KEY`, `apiKey`, `api_key`, `geminiApiKey`, `x-goog-api-key`, `geminiKey`, `GEMINI_KEY_NAME`, ... */
const KEY_NAME = /api[_-]?key|gemini\w*key/i;

function isLogCall(name: string): boolean {
  const parts = name.split(/\s*\??\.\s*/);
  return parts.some((part) => LOG_OWNER.test(part)) || LOG_METHOD.test(parts[parts.length - 1] ?? '');
}

/** The index of the `)` that closes the `(` at `from`, or -1. `bare` has no strings or comments to mislead it. */
function closingParen(bare: string, from: number): number {
  let depth = 0;
  for (let k = from; k < bare.length; k++) {
    if (bare[k] === '(') depth++;
    else if (bare[k] === ')' && --depth === 0) return k;
  }
  return -1;
}

/**
 * A console / logger call (`console.*`, `logger.*`, `log(...)`, `x.log(...)`, `.warn(...)`, `out(...)`,
 * `process.stdout.write(...)`, ...) whose arguments mention `GEMINI_API_KEY` or a name like `apiKey`, as a
 * variable or inside a string. A function declared with such a name is not a call.
 */
function logKeyHits(lexed: Lexed): Hit[] {
  const hits: Hit[] = [];
  for (const call of lexed.bare.matchAll(CALL)) {
    if (!isLogCall(call[1] ?? '')) continue;
    if (/(?:^|[^\w$])function\s*\*?\s*$/.test(lexed.bare.slice(Math.max(0, call.index - 40), call.index))) continue;
    const from = call.index + call[0].length - 1;
    const to = closingParen(lexed.bare, from);
    const end = to === -1 ? lexed.code.length : to;
    if (to !== -1 && /^\s*\{/.test(lexed.bare.slice(to + 1, to + 200))) continue; // `log(line) { ... }`: a method
    const found = KEY_NAME.exec(lexed.code.slice(from + 1, end));
    if (found) hits.push({ line: lineOf(lexed.code, from + 1 + found.index), rule: LOG_KEY });
  }
  return hits;
}

const UNREADABLE = 'could not be read as TypeScript by this test';

function serverHits(source: string): Hit[] {
  const lexed = lex(source);
  if (lexed.problem !== null) return [{ line: 1, rule: `${UNREADABLE}: ${lexed.problem}` }];
  return [...urlKeyHits(lexed), ...logKeyHits(lexed)].sort((a, b) => a.line - b.line);
}

const SERVER_SOURCE = /\.(?:ts|mts|cts|js|mjs|cjs)$/;
const serverFiles = (): string[] =>
  [...walk('server', NOT_SOURCE), ...walk('scripts', NOT_SOURCE)].filter((file) => SERVER_SOURCE.test(file));

describe('Gemini key rule: the reader of server code', () => {
  it('blanks comments and keeps strings, with every line where it was', () => {
    const source = [
      "const a = 'one'; // never ?key= here",
      '/* a block',
      '   over two lines */ const b = "two";',
      'const c = `three ${a + `four ${b}`} five`;',
      "const d = /([?&]key=)[^&\\s\"'<>]*/g.test(a) ? a / 2 : b;",
      "const url = 'https://example.com/x'; // the slashes in a string are not a comment",
    ].join('\n');
    const lexed = lex(source);
    expect(lexed.problem).toBeNull();
    // Line ends are trimmed here; the two length checks below show that nothing moved.
    const lines = (text: string): string[] => text.split('\n').map((line) => line.trimEnd());
    expect(lines(lexed.code)).toStrictEqual([
      "const a = 'one';",
      '',
      '                     const b = "two";',
      'const c = `three ${a + `four ${b}`} five`;',
      "const d = /([?&]key=)[^&\\s\"'<>]*/g.test(a) ? a / 2 : b;",
      "const url = 'https://example.com/x';",
    ]);
    expect(lines(lexed.bare)).toStrictEqual([
      "const a = '   ';",
      '',
      '                     const b = "   ";',
      'const c = `      ${a + `     ${b}`}     `;',
      'const d = /                     /g.test(a) ? a / 2 : b;',
      "const url = '                     ';",
    ]);
    expect(lexed.strings.map((piece) => piece.text)).toStrictEqual(['one', 'two', 'three ', 'four ', '', ' five', 'https://example.com/x']);
    expect(lexed.code).toHaveLength(source.length);
    expect(lexed.bare).toHaveLength(source.length);
  });

  it('says so when a file ends inside a string, a template or a comment', () => {
    expect(lex("const a = 'open\nconst b = 1;").problem).toBe('a string with no end that starts on line 1');
    expect(lex('const a = 1;\nconst b = `open ${a}').problem).toBe('a template with no end that starts on line 2');
    expect(lex('const a = `${ {').problem).toBe('a template expression with no end that starts on line 1');
    expect(lex('const a = 1; /* open').problem).toBe('a comment with no end that starts on line 1');
    expect(rulesOf(serverHits("const a = 'open\n"))).toStrictEqual([`${UNREADABLE}: a string with no end that starts on line 1`]);
  });
});

describe('Gemini key rule: no key in a Gemini URL', () => {
  it('catches ?key= and &key= on a Gemini URL, in a string or a template', () => {
    for (const bad of [
      'const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;',
      "const url = 'https://generativelanguage.googleapis.com/v1beta/models?alt=json&key=' + key;",
      'const url = "https://generativelanguage.googleapis.com/v1beta/models?KEY=" + key;',
    ]) {
      expect(rulesOf(serverHits(bad)), bad).toStrictEqual([URL_KEY]);
    }
  });

  it('catches a key added far from the host: another line, a constant, URLSearchParams or searchParams', () => {
    for (const bad of [
      "const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';\n\nfetch(`${GEMINI_URL}/${model}:generateContent?key=${k}`);",
      "import { GEMINI_MODELS_URL } from './gemini';\nconst url = GEMINI_MODELS_URL + '/m:generateContent' + '?key=' + k;",
      "const url = `${base}/${model}:generateContent?${'key=' + k}`;",
      'const url = `${GEMINI_MODELS_URL}?${new URLSearchParams({ alt: "json", key: k })}`;',
      'const query = new URLSearchParams({ key });\nfetch(`${GEMINI_MODELS_URL}?${query}`);',
      "const query = new URLSearchParams({ 'key': secret });\nfetch(geminiUrl + '?' + query);",
      "const query = new URLSearchParams([['key', k]]);\nfetch(geminiUrl + '?' + query);",
      "const url = new URL(GEMINI_MODELS_URL);\nurl.searchParams.set('key', k);",
      'const url = new URL(GEMINI_MODELS_URL);\nurl.searchParams.append("key", k);',
    ]) {
      expect(rulesOf(serverHits(bad)), bad).toStrictEqual([URL_KEY]);
    }
    expect(serverHits("const GEMINI_URL = 'x';\n\n\nconst url = GEMINI_URL + '?key=' + k;")).toStrictEqual([{ line: 4, rule: URL_KEY }]);
  });

  it('lets the header, a comment about ?key=, a redactor regex and the Google Maps calls through', () => {
    for (const fine of [
      "// the key travels only in the header, never as `?key=` in the URL\nexport const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';",
      "/* never ?key= */ fetch(geminiUrl, { headers: { 'x-goog-api-key': apiKey } });",
      "const safe = geminiText.replace(/([?&]key=)[^&\\s\"'<>]*/g, '$1[redacted]');",
      'const url = `${GEMINI_MODELS_URL}/${encodeURIComponent(model)}:generateContent`;',
      'const url = `${GEMINI_MODELS_URL}?${new URLSearchParams({ alt: "json", monkey: "1" })}`;',
      // Google's Geocoding API takes its (other) key in the query: a file with no Gemini code is not held to the rule.
      'const url = `${GEOCODE_URL}?${new URLSearchParams({ address, key: ctx.apiKey }).toString()}`;',
      "const url = 'https://maps.googleapis.com/maps/api/geocode/json?key=' + key;",
    ]) {
      expect(serverHits(fine), fine).toStrictEqual([]);
    }
  });
});

describe('Gemini key rule: no key in a log', () => {
  it('catches console and logger calls that mention GEMINI_API_KEY', () => {
    for (const bad of [
      'console.log(process.env.GEMINI_API_KEY);',
      "console.info('key', env['GEMINI_API_KEY']);",
      'console.error(`Gemini failed with ${env.GEMINI_API_KEY}`);',
      "console.warn('GEMINI_API_KEY is ' + value);",
      'logger.debug({ GEMINI_API_KEY: value });',
      'log(`key: ${process.env.GEMINI_API_KEY ?? "none"}`);',
    ]) {
      expect(rulesOf(serverHits(bad)), bad).toStrictEqual([LOG_KEY]);
    }
  });

  it('catches a variable named like apiKey in any kind of log call, on any line of it', () => {
    for (const bad of [
      'console.log(apiKey);',
      'console.log("calling Gemini", { apiKey });',
      'console?.debug(opts.apiKey);',
      'console.log(\n  "calling Gemini",\n  JSON.stringify({ model, api_key: k }),\n);',
      'logger.info(`key ${geminiApiKey}`);',
      'this.logger.warn(format(API_KEY));',
      'req.log.info({ headers: { "x-goog-api-key": k } });',
      'log(geminiKey(process.env));',
      'args.log(`using ${GOOGLE_API_KEY}`);',
      'deps.out(apiKey);',
      'logLine(apiKey);',
      'getLogger().error(apiKey);',
      'process.stdout.write(apiKey + "\\n");',
      'if (debug) print(GEMINI_KEY_NAME, value);',
    ]) {
      expect(rulesOf(serverHits(bad)), bad).toStrictEqual([LOG_KEY]);
    }
    expect(serverHits('const a = 1;\nconsole.log(\n  "calling",\n  apiKey,\n);')).toStrictEqual([{ line: 4, rule: LOG_KEY }]);
  });

  it('lets through logs that do not mention the key, and code that uses the key without logging it', () => {
    for (const fine of [
      "console.warn('[parse-request] Gemini is unavailable: HTTP 403. Parsed offline.');",
      'console.warn(`[parse-request] ${unavailable.message}`);',
      'log(keyStartLine(key));',
      "const apiKey = geminiKey(process.env);\nconsole.log('Gemini key: set');",
      "const headers = { 'x-goog-api-key': apiKey };\nconsole.log('sending');",
      'const text = redact(message, ctx.apiKey);\nconsole.error(text);',
      "console.log('done'); // apiKey is never logged",
      'function log(apiKey: string): void {\n  send(apiKey);\n}',
      'const logger = { warn(apiKey: string) {\n  send(apiKey);\n} };',
      'const login = (apiKey: string) => check(apiKey);\nlogin(apiKey);',
    ]) {
      expect(serverHits(fine), fine).toStrictEqual([]);
    }
  });
});

describe('Gemini key rule: server/ and scripts/', () => {
  it('no .ts file puts a key on a Gemini URL or passes one to a log', () => {
    const files = serverFiles();
    // Really the server and the scripts; server/ai/ (the Gemini client, #765) is read whenever it exists.
    expect(files).toContain('server/index.ts');
    expect(files).toContain('server/geo/googleClient.ts');
    expect(files).toContain('scripts/fetch-routes.ts');
    expect(files.length).toBeGreaterThan(50);
    expect(scan(files, serverHits)).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 4. VITE_ names, the Vite config and .env
// ---------------------------------------------------------------------------------------------------------------

const VITE_NAME = 'is a VITE_ name with GEMINI in it: Vite puts every VITE_ variable into the browser bundle';
const VITE_CONFIG_GEMINI = 'mentions Gemini in the Vite config: nothing about it may be built into the client';
const VITE_CONFIG_PREFIX = 'sets envPrefix: the default (VITE_ only) is what keeps GEMINI_API_KEY out of the bundle';
const ENV_FILE = 'is an env file git would commit: keep keys in the gitignored .env only';

function viteNameHits(text: string): Hit[] {
  return text.split('\n').flatMap((line, index) => (/VITE_\w*GEMINI/i.test(line) ? [{ line: index + 1, rule: VITE_NAME }] : []));
}

function viteConfigHits(text: string): Hit[] {
  return text.split('\n').flatMap((line, index) => [
    ...(/gemini/i.test(line) ? [{ line: index + 1, rule: VITE_CONFIG_GEMINI }] : []),
    ...(/envPrefix/.test(line) ? [{ line: index + 1, rule: VITE_CONFIG_PREFIX }] : []),
  ]);
}

const isViteConfig = (file: string): boolean => /^vite\.config\.[cm]?[jt]s$/.test(path.posix.basename(file));

/** `.env` and `.env.<anything>` hold real values, at any depth; only a template with placeholder values may be committed. */
function isSecretEnvFile(file: string): boolean {
  const name = path.posix.basename(file);
  return (name === '.env' || name.startsWith('.env.')) && !/^\.env\.(?:example|sample|template)$/.test(name);
}

/** Repo-relative paths from `git ls-files` with the given flags. */
function gitFiles(...flags: string[]): string[] {
  const out = execFileSync('git', ['ls-files', '-z', ...flags], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter((file) => file !== '');
}

/** Tracked files, plus new files that are not gitignored (the next commit takes them). `.env` is gitignored. */
const committedFiles = (): string[] => [...new Set([...gitFiles('--cached'), ...gitFiles('--others', '--exclude-standard')])].sort();

/** False for a file deleted but not yet committed, and for a link or a submodule that is a folder on disk. */
function isFileOnDisk(file: string): boolean {
  try {
    return fs.statSync(path.join(root, file)).isFile();
  } catch {
    return false;
  }
}

/** A file with a NUL byte near its start is not text. */
const isBinary = (bytes: Buffer): boolean => bytes.subarray(0, 8000).includes(0);

describe('Gemini key rule: VITE_ names and .env', () => {
  it('catches a VITE_ name that holds GEMINI, wherever it is written', () => {
    for (const bad of [
      'VITE_GEMINI_API_KEY=your-key-here',
      'const key = import.meta.env.VITE_GEMINI_API_KEY;',
      'const model = import.meta.env.VITE_GEMINI_MODEL;',
      '- Put `VITE_GOOGLE_GEMINI_KEY` in `.env`.',
      'vite_gemini_key: ${{ secrets.KEY }}',
    ]) {
      expect(rulesOf(viteNameHits(bad)), bad).toStrictEqual([VITE_NAME]);
    }
    expect(viteNameHits('PORT=3001\nVITE_GEMINI_API_KEY=x\n')).toStrictEqual([{ line: 2, rule: VITE_NAME }]);
  });

  it('lets the server names and the other VITE_ names through', () => {
    for (const fine of [
      'GEMINI_API_KEY=your-key-here',
      'GEMINI_MODEL=gemini-2.5-flash',
      'VITE_GOOGLE_MAPS_BROWSER_KEY=your-key-here',
      '`GEMINI_API_KEY` is server only: never a `VITE_` variable.',
      'VITE_GOOGLE_MAPS_BROWSER_KEY is for the browser, GEMINI_API_KEY is not.',
    ]) {
      expect(viteNameHits(fine), fine).toStrictEqual([]);
    }
  });

  it('catches a Vite config that would build Gemini settings into the client', () => {
    expect(rulesOf(viteConfigHits("  envPrefix: ['VITE_', 'GEMINI_'],"))).toStrictEqual([VITE_CONFIG_GEMINI, VITE_CONFIG_PREFIX]);
    expect(rulesOf(viteConfigHits("  envPrefix: '',"))).toStrictEqual([VITE_CONFIG_PREFIX]);
    expect(rulesOf(viteConfigHits("  define: { __AI_KEY__: JSON.stringify(process.env.GEMINI_API_KEY) },"))).toStrictEqual([VITE_CONFIG_GEMINI]);
    expect(viteConfigHits("  envDir: '..', // read the repo-root .env (VITE_GOOGLE_MAPS_BROWSER_KEY)")).toStrictEqual([]);
    expect(['vite.config.ts', 'client/vite.config.mjs'].map(isViteConfig)).toStrictEqual([true, true]);
    expect(['vitest.config.ts', 'vite.config.ts.md', 'server/vite.ts'].map(isViteConfig)).toStrictEqual([false, false, false]);
  });

  it('knows an env file with real values from a template', () => {
    for (const bad of ['.env', '.env.local', '.env.production', 'client/.env', 'server/.env.development.local']) {
      expect(isSecretEnvFile(bad), bad).toBe(true);
    }
    for (const fine of ['.env.example', '.env.sample', 'server/geo/env.ts', 'server/ai/env.ts', 'docs/env.md', '.environment', '.envrc']) {
      expect(isSecretEnvFile(fine), fine).toBe(false);
    }
  });

  it('no file git holds, or would take in the next commit, has a VITE_ name with GEMINI in it', () => {
    const files = committedFiles();
    expect(files).toContain('vite.config.ts');
    expect(files).toContain('tests/api/gemini-key-guard.test.ts');
    expect(files.length).toBeGreaterThan(400);
    // tests/ is left out: a test names the forbidden variable to prove it is refused (this file, and
    // tests/ai/gemini.test.ts, which checks that `geminiKey` ignores it). A test file never reaches the browser.
    // Env files are never read here, not even to check them: the next test fails on their being there at all.
    const read = files.filter((file) => !file.startsWith('tests/') && !isSecretEnvFile(file) && isFileOnDisk(file));
    const found = read.flatMap((file) => {
      const bytes = fs.readFileSync(path.join(root, file));
      return isBinary(bytes) ? [] : viteNameHits(bytes.toString('latin1')).map((hit) => `${file}:${hit.line} ${hit.rule}`);
    });
    expect(found).toStrictEqual([]);
  });

  it('the Vite config does not mention Gemini or change the VITE_ prefix', () => {
    const configs = committedFiles().filter(isViteConfig);
    expect(configs).toContain('vite.config.ts');
    expect(scan(configs.filter(isFileOnDisk), viteConfigHits)).toStrictEqual([]);
  });

  it('.env is not tracked, and no other env file with real values is tracked or about to be', () => {
    expect(committedFiles().filter(isSecretEnvFile).map((file) => `${file} ${ENV_FILE}`)).toStrictEqual([]);
    expect(gitFiles('--cached').filter((file) => path.posix.basename(file) === '.env')).toStrictEqual([]);
    // `.env` stays gitignored, so `git add` cannot take it by accident.
    expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split('\n').map((line) => line.trim())).toContain('.env');
  });
});
