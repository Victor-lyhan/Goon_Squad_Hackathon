import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatCents, formatDuration, formatKg, formatMin } from '../../client/src/ui/format';
import { StatusPill, statusLabel } from '../../client/src/ui/StatusPill';
import { Toast } from '../../client/src/ui/Toast';
import { Spinner } from '../../client/src/ui/Spinner';
import { Button } from '../../client/src/ui/Button';
import { EmptyState } from '../../client/src/ui/EmptyState';
import { readFileSync } from 'node:fs';

describe('formatters', () => {
  it('formatMin at day boundaries', () => {
    const cases: [number, string][] = [
      [0, 'Day 1, 12:00 AM'], [930, 'Day 1, 3:30 PM'], [1439, 'Day 1, 11:59 PM'],
      [1440, 'Day 2, 12:00 AM'], [1950, 'Day 2, 8:30 AM'], [2160, 'Day 2, 12:00 PM'],
    ];
    for (const [m, s] of cases) expect(formatMin(m)).toBe(s);
    expect(formatMin(-5)).toBe('Day 1, 12:00 AM');
    expect(formatMin(NaN)).toBe('Day 1, 12:00 AM');
  });
  it('formatCents', () => {
    const cases: [number, string][] = [
      [0, '$0.00'], [5, '$0.05'], [50, '$0.50'], [300, '$3.00'], [1000, '$10.00'], [1450, '$14.50'],
      [-5, '-$0.05'], [-300, '-$3.00'], [-1450, '-$14.50'],
    ];
    for (const [c, s] of cases) expect(formatCents(c)).toBe(s);
  });
  it('formatKg', () => {
    expect(formatKg(1)).toBe('<0.1 kg');
    expect(formatKg(500)).toBe('0.5 kg');
    expect(formatKg(2000)).toBe('2 kg');
  });
  it('formatDuration', () => {
    const cases: [number, string][] = [[0, '0 min'], [1, '1 min'], [59, '59 min'], [60, '1 h'], [61, '1 h 1 min']];
    for (const [m, s] of cases) expect(formatDuration(m)).toBe(s);
  });
});

describe('StatusPill', () => {
  it('covers every ShipmentProgress and JobStatus value in shared/types.ts', () => {
    const src = readFileSync('shared/types.ts', 'utf8');
    const values = (name: string) => {
      const m = src.match(new RegExp(`export type ${name} =([^;]+);`));
      expect(m).toBeTruthy();
      return [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    };
    const all = [...values('ShipmentProgress'), ...values('JobStatus')];
    expect(all).toContain('unmatched');
    expect(all.length).toBeGreaterThanOrEqual(9);
    for (const v of all) {
      const label = statusLabel(v as never);
      expect(label).toMatch(/^[A-Z][a-z ]+$/);
      const html = renderToStaticMarkup(<StatusPill status={v as never} />);
      expect(html).toContain(label);
      expect(html).toMatch(/ui-pill--(neutral|info|warn|success|danger)/);
    }
  });
  it('does not crash on an unknown status', () => {
    expect(renderToStaticMarkup(<StatusPill status={'on_hold' as never} />)).toContain('On hold');
  });
});

describe('a11y bits', () => {
  it('Toast is a polite live region; errors are alerts', () => {
    const html = renderToStaticMarkup(
      <Toast onDismiss={() => {}} toasts={[{ id: 1, message: 'ok', kind: 'info' }, { id: 2, message: 'bad', kind: 'error' }]} />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toMatch(/role="alert"[^>]*>.*Error: bad/);
    expect(html.match(/role="alert"/g)).toHaveLength(1);
  });
  it('Spinner has an accessible label', () => {
    expect(renderToStaticMarkup(<Spinner />)).toContain('Loading');
    expect(renderToStaticMarkup(<Spinner label="Saving" />)).toContain('Saving');
  });
  it('Button loading is busy and disabled', () => {
    const html = renderToStaticMarkup(<Button loading>Go</Button>);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled');
    expect(renderToStaticMarkup(<Button>Go</Button>)).not.toContain('aria-busy');
  });
  it('EmptyState renders its title as a heading', () => {
    expect(renderToStaticMarkup(<EmptyState title="Nothing" />)).toMatch(/<h3[^>]*>Nothing<\/h3>/);
  });
});
