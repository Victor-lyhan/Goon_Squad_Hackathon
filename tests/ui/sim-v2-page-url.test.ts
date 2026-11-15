import { describe, expect, it } from 'vitest';
import {
  BACK_TO_NETWORK,
  PLAY_KEY,
  hasAutoPlayKey,
  isStale,
  parseSimUrl,
  resolveSelection,
  simUrlFor,
  staleMessage,
  wantsAutoPlay,
  withoutAutoPlay,
  type SimSelection,
} from '../../client/src/components/sim/v2/page/urlState';

describe('parseSimUrl', () => {
  it('reads each key, with journey mode exactly for a package', () => {
    expect(parseSimUrl('?package=shp-001')).toEqual({ selection: { kind: 'package', id: 'shp-001' }, mode: 'journey' });
    expect(parseSimUrl('?employee=emp-10')).toEqual({ selection: { kind: 'employee', id: 'emp-10' }, mode: 'network' });
    expect(parseSimUrl('?business=biz-3')).toEqual({ selection: { kind: 'business', id: 'biz-3' }, mode: 'network' });
  });

  it('returns no selection and network mode for an empty or unrelated query', () => {
    for (const s of ['', '?', '?speed=2', 'foo=bar&x=1']) {
      expect(parseSimUrl(s)).toEqual({ selection: null, mode: 'network' });
    }
  });

  it('accepts a query without the leading ?', () => {
    expect(parseSimUrl('package=shp-001').selection).toEqual({ kind: 'package', id: 'shp-001' });
  });

  it('gives package precedence over employee over business, whatever the order in the URL', () => {
    expect(parseSimUrl('?business=b&employee=e&package=p')).toEqual({ selection: { kind: 'package', id: 'p' }, mode: 'journey' });
    expect(parseSimUrl('?business=b&employee=e')).toEqual({ selection: { kind: 'employee', id: 'e' }, mode: 'network' });
    expect(parseSimUrl('?business=b&x=1')).toEqual({ selection: { kind: 'business', id: 'b' }, mode: 'network' });
  });

  it('ignores empty values and falls through to the next key', () => {
    expect(parseSimUrl('?package=&employee=e')).toEqual({ selection: { kind: 'employee', id: 'e' }, mode: 'network' });
    expect(parseSimUrl('?package=%20%20&business=b').selection).toEqual({ kind: 'business', id: 'b' });
    expect(parseSimUrl('?package=&employee=&business=')).toEqual({ selection: null, mode: 'network' });
    expect(parseSimUrl('?package')).toEqual({ selection: null, mode: 'network' });
  });

  it('ignores a key repeated with different values, but collapses exact duplicates', () => {
    expect(parseSimUrl('?package=a&package=b&employee=e')).toEqual({ selection: { kind: 'employee', id: 'e' }, mode: 'network' });
    expect(parseSimUrl('?package=a&package=b')).toEqual({ selection: null, mode: 'network' });
    expect(parseSimUrl('?package=a&package=a').selection).toEqual({ kind: 'package', id: 'a' });
    expect(parseSimUrl('?package=&package=a').selection).toEqual({ kind: 'package', id: 'a' });
  });

  it('decodes URL-encoded IDs', () => {
    expect(parseSimUrl('?package=shp%2F001%20x').selection).toEqual({ kind: 'package', id: 'shp/001 x' });
    expect(parseSimUrl('?employee=emp+10').selection).toEqual({ kind: 'employee', id: 'emp 10' });
    expect(parseSimUrl('?business=caf%C3%A9%26co').selection).toEqual({ kind: 'business', id: 'café&co' });
  });
});

describe('simUrlFor', () => {
  it('writes the canonical query string for each kind and for no selection', () => {
    expect(simUrlFor({ kind: 'package', id: 'shp-001' })).toBe('?package=shp-001');
    expect(simUrlFor({ kind: 'employee', id: 'emp-10' })).toBe('?employee=emp-10');
    expect(simUrlFor({ kind: 'business', id: 'biz-3' })).toBe('?business=biz-3');
    expect(simUrlFor(null)).toBe('');
    expect(simUrlFor({ kind: 'package', id: '  ' })).toBe('');
  });

  it('encodes IDs', () => {
    expect(simUrlFor({ kind: 'package', id: 'a&b=c/d' })).toBe('?package=a%26b%3Dc%2Fd');
  });

  it('round-trips through parseSimUrl, including odd IDs', () => {
    const cases: SimSelection[] = [
      null,
      { kind: 'package', id: 'shp-001' },
      { kind: 'employee', id: 'emp 10' },
      { kind: 'business', id: 'café&co=1?#' },
      { kind: 'package', id: '+%2F' },
    ];
    for (const sel of cases) {
      expect(parseSimUrl(simUrlFor(sel)).selection).toEqual(sel);
      expect(parseSimUrl(simUrlFor(sel, '?speed=2&package=old&tab=x')).selection).toEqual(sel);
    }
  });

  it('preserves unknown keys in order and replaces any old selection key', () => {
    const current = '?speed=2&employee=emp-1&tab=legs&business=b&package=old';
    expect(simUrlFor({ kind: 'package', id: 'shp-9' }, current)).toBe('?package=shp-9&speed=2&tab=legs');
    expect(simUrlFor({ kind: 'business', id: 'b2' }, current)).toBe('?business=b2&speed=2&tab=legs');
    expect(simUrlFor(null, current)).toBe('?speed=2&tab=legs');
    expect(simUrlFor(null, 'tag=a&tag=b')).toBe('?tag=a&tag=b');
  });

  it('gives the mode back after the round trip', () => {
    expect(parseSimUrl(simUrlFor({ kind: 'package', id: 'p' }, '?x=1')).mode).toBe('journey');
    expect(parseSimUrl(simUrlFor({ kind: 'employee', id: 'e' }, '?package=p')).mode).toBe('network');
    expect(parseSimUrl(simUrlFor(null, '?package=p')).mode).toBe('network');
  });
});

describe('resolveSelection', () => {
  const ids = {
    shipmentIds: ['shp-001', 'shp-002'],
    employeeIds: new Set(['emp-1']),
    businessIds: ['biz-1'],
  };

  it('keeps a selection that is in the current run', () => {
    expect(resolveSelection({ kind: 'package', id: 'shp-002' }, ids)).toEqual({ kind: 'package', id: 'shp-002' });
    expect(resolveSelection({ kind: 'employee', id: 'emp-1' }, ids)).toEqual({ kind: 'employee', id: 'emp-1' });
    expect(resolveSelection({ kind: 'business', id: 'biz-1' }, ids)).toEqual({ kind: 'business', id: 'biz-1' });
    expect(resolveSelection(null, ids)).toBeNull();
  });

  it('marks a stale ID for each kind', () => {
    for (const kind of ['package', 'employee', 'business'] as const) {
      const r = resolveSelection({ kind, id: 'gone-1' }, ids);
      expect(r).toEqual({ stale: true, kind, id: 'gone-1' });
      expect(isStale(r)).toBe(true);
    }
    expect(isStale(resolveSelection({ kind: 'package', id: 'shp-001' }, ids))).toBe(false);
    expect(isStale(null)).toBe(false);
  });

  it('checks the ID against its own kind only', () => {
    expect(resolveSelection({ kind: 'employee', id: 'shp-001' }, ids)).toEqual({ stale: true, kind: 'employee', id: 'shp-001' });
    expect(resolveSelection({ kind: 'package', id: 'biz-1' }, ids)).toEqual({ stale: true, kind: 'package', id: 'biz-1' });
  });

  it('treats everything as stale in an empty run', () => {
    const empty = { shipmentIds: [], employeeIds: [], businessIds: [] };
    expect(isStale(resolveSelection({ kind: 'package', id: 'shp-001' }, empty))).toBe(true);
  });

  it('resolves a parsed deep link end to end', () => {
    const { selection, mode } = parseSimUrl('?package=shp-404');
    expect(mode).toBe('journey');
    expect(resolveSelection(selection, ids)).toEqual({ stale: true, kind: 'package', id: 'shp-404' });
  });
});

describe('stale copy', () => {
  it('names the kind and offers Back to network', () => {
    expect(staleMessage('package')).toBe("That package isn't in this run.");
    expect(staleMessage('employee')).toBe("That employee isn't in this run.");
    expect(staleMessage('business')).toBe("That business isn't in this run.");
    expect(BACK_TO_NETWORK).toBe('Back to network');
  });
});

describe('play=1 (#648)', () => {
  it('the key is `play` and only the value 1 asks for Play', () => {
    expect(PLAY_KEY).toBe('play');
    expect(wantsAutoPlay('?package=shp-001&play=1')).toBe(true);
    expect(wantsAutoPlay('package=shp-001&play=1')).toBe(true);
    for (const s of ['', '?package=shp-001', '?play=0', '?play=', '?play=yes', '?replay=1']) expect(wantsAutoPlay(s), s).toBe(false);
  });

  it('does not change the selection or the mode', () => {
    expect(parseSimUrl('?package=shp-001&play=1')).toEqual({ selection: { kind: 'package', id: 'shp-001' }, mode: 'journey' });
    expect(parseSimUrl('?play=1')).toEqual({ selection: null, mode: 'network' });
  });

  it('withoutAutoPlay drops every `play` key and keeps the rest in order', () => {
    expect(withoutAutoPlay('?package=shp-001&play=1')).toBe('?package=shp-001');
    expect(withoutAutoPlay('?play=1&package=shp-001&debug=1&play=0')).toBe('?package=shp-001&debug=1');
    expect(withoutAutoPlay('?play=1')).toBe('');
    expect(withoutAutoPlay('')).toBe('');
  });

  it('hasAutoPlayKey is true for any value of the key', () => {
    expect(hasAutoPlayKey('?play=1')).toBe(true);
    expect(hasAutoPlayKey('?package=a&play=0')).toBe(true);
    expect(hasAutoPlayKey('?package=a')).toBe(false);
    expect(hasAutoPlayKey('?replay=1')).toBe(false);
  });

  it('simUrlFor keeps it like any other key, so a selection made before it is consumed still plays', () => {
    expect(simUrlFor({ kind: 'package', id: 'shp-002' }, '?package=shp-001&play=1')).toBe('?package=shp-002&play=1');
  });
});
