import type { ReactNode } from 'react';
import './page.css';

/** One sentence (#894): what is wrong and what to do about it. */
export const DESKTOP_ONLY_TEXT = 'The simulator needs a wider screen, so open it on a desktop.';
/** The one link, to `/`: the homepage has the Business and Employee entries, which work on a phone. */
export const DESKTOP_ONLY_LINK_TEXT = 'Back to the homepage';

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
          <a href="/">{DESKTOP_ONLY_LINK_TEXT}</a>
        </p>
      </section>
      {children !== undefined && <div className="sim-desktop-content">{children}</div>}
    </>
  );
}
