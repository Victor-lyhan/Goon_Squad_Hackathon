// Stand-in pages for the app-shell DOM tests (#529). The shell tests are about the header and the
// error boundary, so each route renders a one-line page that throws while its name is in `crashing`.
// Imported only from vi.mock factories in tests/ui/kit-dom-shell-*.test.tsx.
import { useLocation } from 'react-router-dom';

/** Page names that throw on their next render. Cleared by the tests. */
export const crashing = new Set<string>();

/** The message a crashing page throws; the tests check it never reaches the page. */
export const CRASH_TEXT = 'kit-dom-shell secret crash detail';

export function stubPage(name: string) {
  return function StubPage() {
    const { pathname } = useLocation();
    if (crashing.has(name)) throw new Error(`${CRASH_TEXT} in ${name}`);
    return <p data-page={name}>{`${name} at ${pathname}`}</p>;
  };
}
