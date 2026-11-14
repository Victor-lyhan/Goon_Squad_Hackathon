import { Link } from 'react-router-dom';
import type { Business } from '../../../../shared/types';
import { EmptyState } from '../../ui';
import { UNKNOWN_BUSINESS_TITLE, firstBusinessHref } from './trackingModel';

/** Friendly state for /business/<unknown> (stale bookmark after Generate/Import). */
export function BusinessNotFound({ businesses }: { businesses: Business[] }) {
  const first = firstBusinessHref(businesses);
  return (
    <div className="bp-main">
      <EmptyState
        title={UNKNOWN_BUSINESS_TITLE}
        description="It may be from before a new city was generated."
        action={
          <p>
            {first && <><Link to={first}>Go to {businesses[0].name}</Link>{' · '}</>}
            <Link to="/">Back to start</Link>
          </p>
        }
      />
    </div>
  );
}
