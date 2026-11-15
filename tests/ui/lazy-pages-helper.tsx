// The Business, Employee and simulator pages are lazy routes of the app shell (#885): the first render of
// such a route shows the shell's loading line until the page's module has arrived. A browser waits for the
// chunk; a test that renders the shell and reads the page at once must have the modules first.
//
//   await loadWorkspacePages();   // top level of a test file (or of its helper), after the imports
//
// After it, every render of AppShell in that test file shows the page at once, static or in the DOM, as
// before #885. A `vi.mock` of a page module still applies: the lazy route imports the mock. The pages are
// never rendered here (a stand-in page that counts its renders or throws is left alone).
// tests/ui/perf-first-load.test.ts checks this helper and the loading line itself.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../../client/src/App';

// Kept from before any test installs fake timers.
const realSetImmediate = setImmediate;

/** One path per lazy route of client/src/App.tsx. The IDs are made up: the pages are not rendered. */
export const LAZY_ROUTE_PATHS = ['/simulator', '/business/biz-any', '/employee/emp-any'] as const;

/** The app shell at `path` as static markup, with both header lists given (nothing is loaded). */
export function shellMarkup(path: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <AppShell initialV2={{ status: 'loading' }} initialV2Businesses={{ status: 'loading' }} />
    </MemoryRouter>,
  );
}

/**
 * Resolves when the three page modules are imported and React has seen them. For a test that mounts the
 * shell first and then waits for the chunk, like a browser: call it inside one `act` right after the mount.
 */
export async function workspacePagesImported(): Promise<void> {
  await Promise.all([
    import('../../client/src/pages/v2/SimulatorV2'),
    import('../../client/src/pages/v2/BusinessV2'),
    import('../../client/src/pages/v2/EmployeeV2'),
  ]);
  // React's own `then` on its import of the same module runs in a microtask; let them all run.
  await new Promise((resolve) => realSetImmediate(resolve));
}

let loaded: Promise<void> | undefined;

/** Starts the three lazy routes (a first render of each, which shows the loading line) and waits for their modules. */
export function loadWorkspacePages(): Promise<void> {
  loaded ??= (async () => {
    for (const path of LAZY_ROUTE_PATHS) shellMarkup(path);
    await workspacePagesImported();
  })();
  return loaded;
}
