import type { ReactNode } from 'react';
import './ui.css';

export type CardProps = {
  /** Optional heading rendered at the top of the card. */
  title?: ReactNode;
  /** Extra class names. */
  className?: string;
  /** Card content. */
  children?: ReactNode;
};

export function Card({ title, className, children }: CardProps) {
  return (
    <section className={`ui-card${className ? ` ${className}` : ''}`}>
      {title && <h3 className="ui-card__title">{title}</h3>}
      {children}
    </section>
  );
}
