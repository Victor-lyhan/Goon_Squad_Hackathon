import type { ReactNode } from 'react';

export type PanelSectionProps = { title: string; children: ReactNode };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** A titled group in a workspace panel (Playback, Packages, Focus, Direct only vs relay points), 1px divider on top. */
export function PanelSection({ title, children }: PanelSectionProps) {
  const headingId = `sw-section-${slug(title)}`;
  return (
    <section className="sw-section" aria-labelledby={headingId}>
      <h2 className="sw-section-title" id={headingId}>{title}</h2>
      <div className="sw-section-body">{children}</div>
    </section>
  );
}
