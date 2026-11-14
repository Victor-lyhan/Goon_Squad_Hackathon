// A link of the Employee page (#584). Inside the app's router it is the router's `Link`: a click changes
// the location without loading a new document, and Ctrl/Cmd/Shift-click or a middle click still open the
// `href` the browser's way. Rendered without a router (a piece on its own in a static test) it is a plain
// `<a href>`, so the Employee pieces stay props-only.
import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { Link, useInRouterContext, useLocation } from 'react-router-dom';

/** The shell's `<main>` (the skip link's target in App.tsx). */
export const SHELL_MAIN_ID = 'main-content';

export type PageLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  /** An in-app path with its query string, e.g. `/employee/emp-1?job=job-1` or `/simulator?package=shp-1`. */
  to: string;
};

/** The path of an in-app href, without query, hash and trailing slashes. */
export const pathOf = (href: string) => href.split(/[?#]/)[0].replace(/\/+$/, '') || '/';

/** A click the router handles itself: left button, no modifier key, same tab, not cancelled by a handler. */
export function isRouterClick(
  e: Pick<MouseEvent, 'button' | 'metaKey' | 'altKey' | 'ctrlKey' | 'shiftKey' | 'defaultPrevented'>,
  target?: string,
): boolean {
  return !e.defaultPrevented && e.button === 0 && (!target || target === '_self')
    && !(e.metaKey || e.altKey || e.ctrlKey || e.shiftKey);
}

/**
 * What a document load used to give a link to another page: the new page starts at the top, with focus at
 * the start of the content instead of on a link that no longer exists. The shell's `<main>` stays mounted
 * across pages, so it can take focus before the router swaps its content.
 */
function startAtTop() {
  document.documentElement.scrollTop = 0;
  document.getElementById(SHELL_MAIN_ID)?.focus({ preventScroll: true });
}

function RouterPageLink({ to, onClick, ...rest }: PageLinkProps) {
  const { pathname } = useLocation();
  // `?job=` on this same page keeps its place: the job view takes focus when it opens.
  const leavesPage = pathOf(to) !== pathOf(pathname);
  return (
    <Link
      to={to}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (leavesPage && isRouterClick(e, rest.target)) startAtTop();
      }}
    />
  );
}

export function PageLink(props: PageLinkProps) {
  const inRouter = useInRouterContext();
  if (inRouter) return <RouterPageLink {...props} />;
  const { to, ...rest } = props;
  return <a href={to} {...rest} />;
}
