import type { ReactNode } from 'react';
import './page.css';

export const DESKTOP_ONLY_TEXT =
  'The simulator needs a wider screen. Open Relay on a desktop, or use the Business and Employee workspaces on this device.';

/**
 * Below 900 px the simulator shows this notice instead of the workspace; at 900 px and above
 * the notice is hidden. Both are decided by the media query in page.css, never by measuring the viewport in JS.
 * Pass the workspace as children so it is hidden on narrow screens.
 */
export function DesktopOnlyNotice({ children }: { children?: ReactNode }) {
  return (
    <>
      <section className="sim-desktop-notice" role="note" aria-label="Simulator needs a wider screen">
        <p className="sim-desktop-notice-text">{DESKTOP_ONLY_TEXT}</p>
        <p className="sim-desktop-notice-links">
          <a href="/">Choose a workspace</a>
        </p>
      </section>
      {children !== undefined && <div className="sim-desktop-content">{children}</div>}
    </>
  );
}
