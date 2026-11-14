import type { ReactNode } from 'react';
import './ui.css';

export type EmptyStateProps = {
  /** Short heading, e.g. "No shipments yet". */
  title: string;
  /** Optional explanation or next step. */
  description?: ReactNode;
  /** Optional call-to-action (e.g. a Button). */
  action?: ReactNode;
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="ui-empty">
      <h3 className="ui-empty__title">{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
