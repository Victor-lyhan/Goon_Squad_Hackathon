import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from './Button';
import './shell.css';

export const ERROR_FALLBACK_TITLE = 'This page hit a problem';
export const ERROR_FALLBACK_TEXT = 'Something went wrong while showing this page. The header above still works.';

export type ErrorBoundaryProps = {
  children: ReactNode;
  /**
   * When this changes a shown fallback is cleared and the children render again. The app shell passes the
   * pathname plus the query string, not the hash (#705).
   */
  resetKey: string;
  /** The homepage link in the fallback (/nyc on a preview path, / elsewhere). */
  homeHref: string;
  /** "Reload page" action; defaults to a full browser reload (tests inject a spy). */
  onReload?: () => void;
};

type State = { failed: boolean; key: string };

/**
 * Catches a render error in the page below the header (DECISIONS pass 57). Shows a short fallback with
 * role="alert" instead of a blank screen. The error text is never shown on the page (React still logs it).
 * Must sit inside the router, because the fallback uses <Link>.
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
    return (
      <section className="error-fallback" role="alert" aria-labelledby="error-fallback-title">
        <h1 id="error-fallback-title" className="error-fallback__title">{ERROR_FALLBACK_TITLE}</h1>
        <p className="error-fallback__text">{ERROR_FALLBACK_TEXT}</p>
        <div className="error-fallback__actions">
          <Button variant="primary" onClick={this.reload}>Reload page</Button>
          <Link to={this.props.homeHref} className="error-fallback__home">Go to the homepage</Link>
        </div>
      </section>
    );
  }
}
