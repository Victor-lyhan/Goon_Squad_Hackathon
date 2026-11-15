import { useEffect, useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { readIdentity } from '../demoIdentity';
import { LOGO_SRC } from '../ui/brand';
import LandingHeroMap from './LandingHeroMap';
import { ACCOUNTS_ERROR_TEXT } from '../ui/shellModel';
import {
  NYC_UNAVAILABLE_TEXT, nycWorkspacePaths, startNycSummary, watchPackageHref, type NycSummary,
} from './landingModel';
import '../ui/ui.css'; // .ui-sr-only, for the title's hidden R
import '../styles/landing.css';

/** The title of the homepage (#833), its only h1. */
export const LANDING_TITLE = 'Relay: packages ride the commute, cheaper and greener';
/** The title's first word with its colon ("Relay:"): the logo is drawn in place of its first letter (#853). */
const TITLE_WORD = LANDING_TITLE.slice(0, LANDING_TITLE.indexOf(' '));

/**
 * The title with the Relay logo as the R of "Relay" (#853). The logo is decorative (empty alt) and the letter
 * it stands for is kept in the text, hidden from sight, so the text of the heading is still the whole title.
 * The heading's label says the title in one piece, so a screen reader does not spell the word in two parts.
 * The word and its colon are one box (landing.css), so a line never breaks between the logo and "elay:".
 */
export function LandingTitle() {
  return (
    <h1 id="landing-title" aria-label={LANDING_TITLE}>
      <span className="landing-title-word">
        <img className="landing-title-logo" src={LOGO_SRC} alt="" width={40} height={40} />
        <span className="ui-sr-only">{TITLE_WORD[0]}</span>
        {TITLE_WORD.slice(1)}
      </span>
      {LANDING_TITLE.slice(TITLE_WORD.length)}
    </h1>
  );
}
export const WATCH_LABEL = 'Watch a package';

type WorkspaceKey = 'business' | 'employee';

export const WORKSPACES: { key: WorkspaceKey; title: string; text: string }[] = [
  { key: 'business', title: 'Business', text: 'Send a package and track it' },
  { key: 'employee', title: 'Employee', text: 'Set a commute and see your deliveries' },
];

/** The id of the line under the button; the button is described by it. */
export const WATCH_NOTE_ID = 'landing-watch-note';
/**
 * Said under the button in a window too narrow for the simulator (below its own breakpoint, where it
 * shows only its "needs a wider screen" notice): the reader is told before the press, and where to read on.
 */
export const WATCH_NOTE_NARROW = 'The simulator needs a wider screen. On this one, read How it works below.';
/** The line while the button was pressed before the run had loaded: the page opens the journey as soon as it has. */
export const WATCH_WAIT_TEXT = 'Opening the simulator…';

/**
 * The large primary button: a link, so it works with the keyboard and before the run has loaded.
 * `onClick` lets the page hold a press that came before it knows the package (#908).
 */
export function WatchButton({ to, onClick }: { to: string; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void }) {
  return (
    <Link className="watch-button" to={to} aria-describedby={WATCH_NOTE_ID} onClick={onClick}>
      <svg className="watch-button-icon" viewBox="0 0 12 12" width="14" height="14" aria-hidden="true" focusable="false">
        <path d="M2 1l9 5-9 5z" fill="currentColor" />
      </svg>
      {WATCH_LABEL}
    </Link>
  );
}

/**
 * One line under the button (#908), which a wide window never shows: the hero there stays the title, the
 * button and the two entries (#853). Below 900 px landing.css shows the sentence about the wider screen,
 * so a phone is told before the press; hidden, it is `display: none` and not read out either. While
 * `waiting` (any width) the line says the simulator is opening; that status region is in the page from
 * the start, so a screen reader announces it.
 */
export function WatchNote({ waiting = false }: { waiting?: boolean }) {
  return (
    <p className={`watch-note${waiting ? ' is-waiting' : ''}`} id={WATCH_NOTE_ID}>
      <span className="watch-note-narrow">{WATCH_NOTE_NARROW}</span>
      <span className="watch-note-wait" role="status">{waiting ? WATCH_WAIT_TEXT : ''}</span>
    </p>
  );
}

/** An entry's two lines. No arrow after them (#879): the outlined box is the link, and it says where it goes. */
function EntryBody({ title, text }: { title: string; text: string }) {
  return (
    <span className="workspace-body">
      <span className="workspace-title">{title}</span>
      <span className="workspace-text">{text}</span>
    </span>
  );
}

/** Business and Employee, the two smaller entries. An entry whose account list is not loaded is not a link yet. */
export function WorkspaceEntries({ paths }: { paths: { business: string | null; employee: string | null } }) {
  return (
    <ul className="workspaces" aria-label="Workspaces">
      {WORKSPACES.map((w) => {
        const to = paths[w.key];
        // Title and text by name: spreading `w` would hand its `key` to JSX, which React reports (#746).
        const body = <EntryBody title={w.title} text={w.text} />;
        return (
          <li key={w.key}>
            {to
              ? <Link className="workspace-entry" to={to}>{body}</Link>
              : <div className="workspace-entry is-disabled" aria-disabled="true">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Why Business and Employee are not links, shown only after a failed load: the 503 line (travel data not
 * loaded) or the header's "Accounts unavailable". The page asks again by itself (#610). The stats line that
 * used to say this is gone (#833).
 */
export function LoadNote({ status }: { status: NycSummary['status'] }) {
  if (status !== 'unavailable' && status !== 'error') return null;
  return (
    <p className="landing-note" role="status">
      {status === 'unavailable' ? NYC_UNAVAILABLE_TEXT : ACCOUNTS_ERROR_TEXT}
    </p>
  );
}

/** The study page (MVP IV F3): a static file outside the SPA, generated by `npm run study`. */
export const STUDY_HREF = '/study.html';
export const STUDY_LABEL = 'See the numbers';

export const HOW_TITLE = 'How it works';
/** The three steps, one line each (#833). */
export const HOW_STEPS: string[] = [
  'A business sends a package.',
  'An employee already commuting picks it up, or hands it off overnight at a relay point.',
  'It arrives the next morning.',
];

/**
 * "How it works" under the hero: three numbered lines and the button to the study page. The button is a
 * plain <a>: the router has no route for a static file.
 */
export function HowItWorks() {
  return (
    <section className="landing-how" aria-labelledby="landing-how-title">
      <h2 id="landing-how-title">{HOW_TITLE}</h2>
      <ol className="landing-steps">
        {HOW_STEPS.map((step, i) => (
          <li key={step}>
            <span className="landing-step-n" aria-hidden="true">{i + 1}</span>
            <span className="landing-step-text">{step}</span>
          </li>
        ))}
      </ol>
      <a className="numbers-button" href={STUDY_HREF}>{STUDY_LABEL}</a>
    </section>
  );
}

/**
 * The NYC summary from /api/v2. A failed load is asked for again until it is ready (#610); the requests and
 * the retry timer are dropped on unmount. `initial` skips the requests (tests).
 */
function useNycSummary(initial?: NycSummary): NycSummary {
  const [summary, setSummary] = useState<NycSummary>(initial ?? { status: 'loading' });
  useEffect(() => {
    if (initial) return;
    return startNycSummary(setSummary);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return summary;
}

/**
 * The homepage (#833): a dark hero with the title (the logo is its R, #853), the large "Watch a package"
 * button (it opens the simulator on the story package and plays it; below 900 px one line under it says
 * the simulator needs a wider screen, #908), Business and Employee as two smaller
 * entries, and a stylized NYC map on which a package is relayed in a loop; under it "How it works" in three
 * lines with the "See the numbers" button to the study page. The hero fills the window under the header, so
 * "How it works" starts below the fold. Its text sits in the left half of a centered column, which "How it
 * works" shares (#853); the map has no frame and covers the hero's right half from edge to edge, or lies
 * under the text on a phone (#869). No stats line and no footer. The header shows no environment line on
 * this page (App.tsx).
 */
export default function Landing({ initialSummary }: {
  /**
   * Accepted and ignored: the NYC page is the only one. `App.tsx` still passes `dataset="nyc"`; remove the
   * prop together with that attribute.
   */
  dataset?: 'nyc';
  /** Skip the /api/v2 requests and render this summary (tests). */
  initialSummary?: NycSummary;
} = {}) {
  const summary = useNycSummary(initialSummary);
  const watchHref = watchPackageHref(summary);
  // #908: while the run is loading the link has no package yet, and a press then opened the simulator
  // with nothing picked (two more presses: a package, Play). Such a press is held instead, and the page
  // goes to the journey as soon as the run is loaded, or to the plain simulator if the load fails (it has
  // its own error state). A press with a modifier key, or with another button, is the browser's.
  const navigate = useNavigate();
  const [waiting, setWaiting] = useState(false);
  const loading = summary.status === 'loading';
  useEffect(() => {
    if (waiting && !loading) navigate(watchHref);
  }, [waiting, loading, watchHref, navigate]);
  const holdWatch = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!loading || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setWaiting(true);
  };
  return (
    <div className="landing landing-nyc">
      <section className="landing-hero" aria-labelledby="landing-title">
        {/* The dark ground runs edge to edge. The text is in the left half of a centered column (#853); the
            map is outside that column, so it can run to the hero's top, bottom and right edge (#869). */}
        <div className="landing-hero-inner">
          <div className="landing-hero-copy">
            <LandingTitle />
            <WatchButton to={watchHref} onClick={holdWatch} />
            <WatchNote waiting={waiting} />
            <WorkspaceEntries paths={nycWorkspacePaths(summary, readIdentity())} />
            <LoadNote status={summary.status} />
          </div>
        </div>
        <LandingHeroMap />
      </section>
      <HowItWorks />
    </div>
  );
}
