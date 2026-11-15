import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from './Button';
import { activeDestination, DESTINATIONS, HOME_PATH } from './shellModel';
import './ui.css';

export const ERROR_FALLBACK_TITLE = 'This page hit a problem';
export const ERROR_FALLBACK_ACTION = 'Reload page';

/** The fallback's one sentence. It names the page by the word its header link uses. */
export function errorFallbackText(pathname: string): string {
  const key = activeDestination(pathname);
  const label = DESTINATIONS.find((d) => d.key === key)?.label;
  if (label) return `Relay could not show the ${label} page.`;
  return pathname === HOME_PATH ? 'Relay could not show the homepage.' : 'Relay could not show this page.';
}

export type ErrorBoundaryProps = {
  children: ReactNode;
  /**
   * When this changes a shown fallback is cleared and the children render again. The app shell passes the
   * pathname plus the query string, not the hash (#705).
   */
  resetKey: string;
  /** No longer read (#886): the fallback has one action, Reload. Kept because the app shell still passes it. */
  homeHref?: string;
  /** "Reload page" action; defaults to a full browser reload (tests inject a spy). */
  onReload?: () => void;
};

type State = { failed: boolean; key: string };

/** One heading, one sentence that names the page, one action. role="alert": read out at once. */
function ErrorFallback({ onReload }: { onReload: () => void }) {
  const { pathname } = useLocation();
  return (
    <section className="ui-state ui-state--problem error-fallback" role="alert" aria-labelledby="error-fallback-title">
      <h1 id="error-fallback-title" className="ui-state__title">{ERROR_FALLBACK_TITLE}</h1>
      <p className="ui-state__text">{errorFallbackText(pathname)}</p>
      <Button variant="primary" onClick={onReload}>{ERROR_FALLBACK_ACTION}</Button>
    </section>
  );
}

/**
 * Catches a render error in the page below the header (DECISIONS pass 57). Shows a short fallback with
 * role="alert" instead of a blank screen. The error's message and stack are never put on the page, in a
 * development or a production build (React still logs the error to the console).
 * Must sit inside the router, because the fallback reads the path to name the page.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  state: State = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: State): Partial<State> | null {
    // A new key (path or query string in the app shell): forget the old failure, so the next page renders.
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }

  componentDidCatch(_error: unknown, _info: ErrorInfo) {
    // Intentionally empty: React already logs the error to the console; the page shows no error text.
  }

  private reload = () => {
    if (this.props.onReload) this.props.onReload();
    else window.location.reload();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return <ErrorFallback onReload={this.reload} />;
  }
}
