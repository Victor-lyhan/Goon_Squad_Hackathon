import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toast, ToastTimers, visibleToasts } from '../../client/src/ui/Toast';

describe('visibleToasts', () => {
  it('shows everything under the cap', () => expect(visibleToasts([1, 2, 3])).toEqual({ visible: [1, 2, 3], hidden: 0 }));
  it('keeps the newest 3 and counts the rest', () => expect(visibleToasts([1, 2, 3, 4, 5])).toEqual({ visible: [3, 4, 5], hidden: 2 }));
  it('handles empty and custom caps', () => {
    expect(visibleToasts([])).toEqual({ visible: [], hidden: 0 });
    expect(visibleToasts([1, 2, 3], 1)).toEqual({ visible: [3], hidden: 2 });
  });
});

describe('Toast markup', () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, message: `msg ${i + 1}`, kind: 'info' as const }));
  it('is a polite live region with a named dismiss button per toast', () => {
    const html = renderToStaticMarkup(<Toast toasts={mk(1)} onDismiss={() => {}} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="Dismiss notification: msg 1"');
  });
  it('renders at most 3 toasts, newest kept, with +N more', () => {
    const html = renderToStaticMarkup(<Toast toasts={mk(5)} onDismiss={() => {}} />);
    expect(html).not.toContain('msg 1<');
    expect(html).not.toContain('msg 2<');
    expect(html).toContain('msg 5');
    expect(html.match(/Dismiss notification/g)).toHaveLength(3);
    expect(html).toContain('+2 more');
  });
  it('shows no "+N more" under the cap', () => {
    expect(renderToStaticMarkup(<Toast toasts={mk(3)} onDismiss={() => {}} />)).not.toContain('more');
  });
});

describe('ToastTimers', () => {
  let expired: number[];
  let t: ToastTimers;
  beforeEach(() => { vi.useFakeTimers(); expired = []; t = new ToastTimers((id) => expired.push(id)); });
  afterEach(() => { t.dispose(); vi.useRealTimers(); });

  it('expires after the duration', () => {
    t.add(1, 1000);
    vi.advanceTimersByTime(999);
    expect(expired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(expired).toEqual([1]);
  });
  it('holds while paused and resumes with the remaining time', () => {
    t.add(1, 1000);
    vi.advanceTimersByTime(600);
    t.pause('1:hover');
    vi.advanceTimersByTime(5000);
    expect(expired).toEqual([]);
    t.resume('1:hover');
    vi.advanceTimersByTime(399);
    expect(expired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(expired).toEqual([1]);
  });
  it('stays held until every hold (hover and focus) is released', () => {
    t.add(1, 1000);
    t.pause('1:hover');
    t.pause('1:focus');
    t.resume('1:hover');
    vi.advanceTimersByTime(5000);
    expect(expired).toEqual([]);
    t.resume('1:focus');
    vi.advanceTimersByTime(1000);
    expect(expired).toEqual([1]);
  });
  it('toasts added while paused wait for the release', () => {
    t.pause('x');
    t.add(2, 1000);
    vi.advanceTimersByTime(5000);
    expect(expired).toEqual([]);
    t.resume('x');
    vi.advanceTimersByTime(1000);
    expect(expired).toEqual([2]);
  });
  it('removed toasts never expire', () => {
    t.add(1, 1000);
    t.remove(1);
    vi.advanceTimersByTime(2000);
    expect(expired).toEqual([]);
  });
});

describe('Toast css', () => {
  const css = readFileSync('client/src/ui/ui.css', 'utf8');
  it('animates only under prefers-reduced-motion: no-preference', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion:no-preference\)\{\s*\.ui-toast\{animation:ui-toast-in/);
    const outside = css.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*\s*\}/g, '');
    expect(outside).not.toMatch(/\.ui-toast\{[^}]*animation/);
  });
});
