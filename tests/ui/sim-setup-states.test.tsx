import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../client/src/api/client';
import {
  CONFIRM_TEXT, confirmReducer, describeActionError, exportFilename, isLockedError, parseImportText, validateSetup, defaultForm,
} from '../../client/src/components/sim/setupModel';

describe('setup confirm step', () => {
  it('asks first, cancel leaves nothing to run, confirm closes the step', () => {
    expect(CONFIRM_TEXT).toBe('This replaces the current city and its packages.');
    const asked = confirmReducer(null, { type: 'ask', action: 'generate' });
    expect(asked).toBe('generate');
    expect(confirmReducer(asked, { type: 'cancel' })).toBeNull();
    expect(confirmReducer(confirmReducer(null, { type: 'ask', action: 'import' }), { type: 'confirm' })).toBeNull();
  });
});

describe('setup errors', () => {
  it('non-JSON and non-object files give readable messages', () => {
    expect(parseImportText('nope')).toEqual({ ok: false, error: 'That file is not valid JSON.' });
    expect(parseImportText('[1]').ok).toBe(false);
    expect(parseImportText('{"runId":"r1"}').ok).toBe(true);
  });
  it('shows the server message for 400', () => {
    expect(describeActionError(new ApiRequestError(400, 'Invalid scenario: schemaVersion'))).toBe('Invalid scenario: schemaVersion');
  });
  it('409 points to a new planning cycle', () => {
    const e = new ApiRequestError(409, 'Planning is locked.');
    expect(isLockedError(e)).toBe(true);
    expect(describeActionError(e)).toMatch(/Start a new planning cycle first/);
    expect(describeActionError(new ApiRequestError(409, 'Planning is locked. Start a new planning cycle to recompute.'))).toMatch(/new planning cycle/);
  });
});

describe('export file name', () => {
  it('uses preset, seed and runId from the response', () => {
    expect(exportFilename({ runId: 'run-3', scenario: { preset: 'demo', seed: 42 } })).toBe('relay-demo-seed42-run-3.json');
    expect(exportFilename({ runId: 'a/b', scenario: { preset: 'random', seed: -7 } })).toBe('relay-random-seed7-a-b.json');
  });
});

describe('generator validation', () => {
  it('rejects out-of-range values before any request', () => {
    expect(validateSetup({ ...defaultForm(), preset: 'random', hubs: '11', maxExtraMin: '31' }).ok).toBe(false);
  });
});
