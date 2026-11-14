import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Drawer } from '../../client/src/ui/Drawer';
import { nextFocusIndex } from '../../client/src/ui/focusCycle';

describe('nextFocusIndex', () => {
  it('wraps forward from the last item', () => expect(nextFocusIndex(3, 2, false)).toBe(0));
  it('wraps backward from the first item', () => expect(nextFocusIndex(3, 0, true)).toBe(2));
  it('leaves middle moves to the browser', () => {
    expect(nextFocusIndex(3, 1, false)).toBeNull();
    expect(nextFocusIndex(3, 1, true)).toBeNull();
  });
  it('pulls focus in when it is outside', () => {
    expect(nextFocusIndex(3, -1, false)).toBe(0);
    expect(nextFocusIndex(3, -1, true)).toBe(2);
  });
  it('single item cycles to itself', () => {
    expect(nextFocusIndex(1, 0, false)).toBe(0);
    expect(nextFocusIndex(1, 0, true)).toBe(0);
  });
  it('does nothing with no items', () => expect(nextFocusIndex(0, -1, false)).toBeNull());
});

describe('Drawer markup', () => {
  it('is a modal dialog labelled by its title', () => {
    const html = renderToStaticMarkup(<Drawer open onClose={() => {}} title="Tracking">x</Drawer>);
    const labelled = /aria-labelledby="([^"]+)"/.exec(html)![1];
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain(`id="${labelled}"`);
    expect(html).toContain('>Tracking<');
  });
  it('renders nothing when closed', () => {
    expect(renderToStaticMarkup(<Drawer open={false} onClose={() => {}} title="T" />)).toBe('');
  });
});
