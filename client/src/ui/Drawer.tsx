import { useEffect, useId, useRef, type ReactNode } from 'react';
import './ui.css';

export type DrawerProps = {
  /** Whether the drawer is shown. */
  open: boolean;
  /** Called on close button, backdrop click or Esc. */
  onClose: () => void;
  /** Heading text (also the dialog's accessible name). */
  title: string;
  /** Drawer content. */
  children?: ReactNode;
};

export function Drawer({ open, onClose, title, children }: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('.ui-drawer__close')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, [open]);
  if (!open) return null;
  return (
    <>
      <div className="ui-drawer__backdrop" onClick={onClose} />
      <div className="ui-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="ui-drawer__header">
          <h2 className="ui-drawer__title" id={titleId}>{title}</h2>
          <button type="button" className="ui-drawer__close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </>
  );
}
