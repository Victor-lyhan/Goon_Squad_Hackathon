import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConnectionBanner } from '../../client/src/ui/ConnectionBanner';
import { initialConnection, nextConnection } from '../../client/src/ui/connectionModel';

describe('connection model', () => {
  it('stays online after one failure, offline after two', () => {
    const one = nextConnection(initialConnection, false);
    expect(one.status).toBe('online');
    expect(nextConnection(one, false).status).toBe('offline');
  });
  it('one success returns to online and resets the count', () => {
    let s = nextConnection(nextConnection(nextConnection(initialConnection, false), false), false);
    expect(s.status).toBe('offline');
    s = nextConnection(s, true);
    expect(s).toEqual(initialConnection);
    expect(nextConnection(s, false).status).toBe('online');
  });
  it('a success between failures resets the streak', () => {
    let s = nextConnection(initialConnection, false);
    s = nextConnection(s, true);
    expect(nextConnection(s, false).status).toBe('online');
  });
});

describe('ConnectionBanner', () => {
  it('renders nothing when online', () => {
    expect(renderToStaticMarkup(<ConnectionBanner status="online" />)).toBe('');
  });
  it('renders the message with role=status when offline', () => {
    const html = renderToStaticMarkup(<ConnectionBanner status="offline" />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Can&#x27;t reach the Relay server. Retrying…");
  });
  it('css respects reduced motion and wraps for narrow screens', () => {
    const css = readFileSync('client/src/ui/ui.css', 'utf8');
    expect(css).toMatch(/prefers-reduced-motion:reduce\)\{[^}]*\.ui-connection-banner\{animation:none\}/);
    expect(css).toContain('overflow-wrap:anywhere');
    expect(css).toContain('box-sizing:border-box');
  });
});
