import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

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
  });

  it('documents the setup scripts', () => {
    for (const s of ['dev', 'build']) expect(readme).toContain(`npm run ${s}`);
  });

  it('mentions the state file and ports', () => {
    expect(readme).toContain('data/state.json');
    expect(readme).toContain('3001');
    expect(readme).toContain('5173');
  });
});
