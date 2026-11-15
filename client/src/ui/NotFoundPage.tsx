import { Link } from 'react-router-dom';
import type { V2BusinessDirectory, V2Directory } from './shell';
import { HOME_PATH } from './shellModel';
import './ui.css';

export const NOT_FOUND_TITLE = 'Page not found';
export const NOT_FOUND_TEXT = 'This address is not a page in Relay.';
export const NOT_FOUND_ACTION = 'Go to the homepage';

/**
 * The 404 page: one heading, one sentence, one button to the homepage (#886). The header above it still
 * has the links to the workspaces and the simulator, so the page repeats none of them and loads nothing.
 */
export default function NotFoundPage(_props: {
  /** No longer read (#886): the page has no workspace links. Kept because the app shell still passes them. */
  initialEmployees?: V2Directory; initialBusinesses?: V2BusinessDirectory;
} = {}) {
  return (
    <section className="ui-state not-found" aria-labelledby="not-found-title">
      <h1 id="not-found-title" className="ui-state__title">{NOT_FOUND_TITLE}</h1>
      <p className="ui-state__text">{NOT_FOUND_TEXT}</p>
      <Link to={HOME_PATH} className="ui-btn ui-btn--primary">{NOT_FOUND_ACTION}</Link>
    </section>
  );
}
